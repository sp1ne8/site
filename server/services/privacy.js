import bcrypt from 'bcrypt';
import { prisma } from '../config/db.js';
import { publicUserSelect } from '../utils/users.js';
import { AppError } from '../utils/errors.js';
import { serializable } from '../utils/transaction.js';
import { initializeLegal, checkedPolicy, documentFor, addDecision, confirmDocument } from './legal.js';
import { verifyConsentConfirmation } from './consent-confirmation.js';

export async function privacyOverview(userId) {
  const [user, consents, requests, holds, sessions] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect }),
    prisma.consentEvent.findMany({ where: { userId }, include: { document: { select: { kind: true, title: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 }),
    prisma.dataRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.retentionHold.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.session.findMany({ where: { userId }, select: { id: true, createdAt: true, expiresAt: true } }),
  ]);
  return { user, consents, requests, holds, sessions };
}
export async function exportData(userId) {
  const [overview, orders, subscriptions] = await Promise.all([
    privacyOverview(userId),
    prisma.order.findMany({ where: { userId }, include: { payments: true }, orderBy: { createdAt: 'desc' } }),
    prisma.subscription.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
  ]);
  // No password hashes, token hashes, reset links, secrets or other users' data.
  return { exportedAt: new Date().toISOString(), ...overview, orders, subscriptions };
}
export async function createDataRequest(userId, input) {
  await initializeLegal();
  if (input.type === 'deletion') {
    const credentials = await prisma.user.findUnique({ where: { id: userId } });
    if (!credentials || !(await bcrypt.compare(input.currentPassword || '', credentials.passwordHash))) throw new AppError(400, 'Для запроса удаления подтвердите текущий пароль.');
  }
  return serializable(async tx => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new AppError(403, 'Аккаунт недоступен.');
    if (await tx.dataRequest.count({ where: { userId, status: { in: ['pending', 'in_review'] } } }) >= 10) throw new AppError(429, 'У вас уже есть 10 незавершённых обращений.');
    const code = user.jurisdiction || 'RU';
    const policy = await tx.jurisdictionPolicy.findUnique({ where: { code } });
    const days = policy?.settings.requestDays;
    return tx.dataRequest.create({ data: { userId, jurisdiction: code, type: input.type, message: input.message || '', dueAt: days ? new Date(Date.now() + days * 86_400_000) : null } });
  });
}
export async function withdrawConsent(userId, type) {
  await initializeLegal();
  return serializable(async tx => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.isBlocked || user.deletedAt) throw new AppError(403, 'Аккаунт недоступен.');
    const policy = await checkedPolicy(tx, user.jurisdiction || 'RU');
    const document = await documentFor(tx, type === 'privacy' ? 'user-consent' : type === 'marketing' ? 'marketing-consent' : 'cookie-policy', policy.code);
    const event = await addDecision(tx, { userId, type, status: 'withdrawn', basis: 'consent', policy, document, confirmationMethod: 'account-withdrawal' });
    if (type === 'privacy' && policy.settings.accountBasis === 'consent') {
      await tx.user.update({ where: { id: userId }, data: { privacyRestricted: true } });
      if (!await tx.dataRequest.findFirst({ where: { userId, type: 'withdrawal', status: { in: ['pending', 'in_review'] } } })) await tx.dataRequest.create({ data: { userId, jurisdiction: policy.code, type: 'withdrawal', message: 'Отозвано согласие основной модели аккаунта. Новые покупки приостановлены; требуется рассмотрение иных применимых оснований и прекращения обработки.' } });
    }
    return event;
  });
}
export async function confirmAccountPolicy(userId, input) {
  await initializeLegal();
  return serializable(async tx => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.isBlocked || user.deletedAt) throw new AppError(403, 'Аккаунт недоступен.');
    if (user.jurisdiction && user.jurisdiction !== input.jurisdiction) throw new AppError(400, 'Изменение юрисдикции существующего аккаунта требует рассмотрения оператором.');
    const policy = await checkedPolicy(tx, input.jurisdiction, { operational: true });
    const confirmationMethod = await verifyConsentConfirmation(policy, input, userId);
    const document = await confirmDocument(tx, 'personal-data-policy', policy.code, input.policyDocumentId);
    await addDecision(tx, { userId, type: 'privacy', status: 'acknowledged', basis: 'notice', policy, document });
    if (policy.settings.accountBasis === 'consent') {
      if (!input.privacyConsent) throw new AppError(400, 'Необходимо отдельное согласие.');
      const consent = await confirmDocument(tx, 'user-consent', policy.code, input.consentDocumentId);
      await addDecision(tx, { userId, type: 'privacy', status: 'granted', basis: 'consent', policy, document: consent, confirmationMethod });
    }
    return tx.user.update({ where: { id: userId }, data: { jurisdiction: policy.code, privacyRestricted: false }, select: publicUserSelect });
  });
}
export async function acceptOffer(tx, user, input) {
  if (user.privacyRestricted) throw new AppError(409, 'Обработка аккаунта ограничена после отзыва согласия. Обратитесь в Privacy & Data.');
  if (!user.jurisdiction) throw new AppError(409, 'Откройте Privacy & Data и выберите юридическую конфигурацию аккаунта.');
  const policy = await checkedPolicy(tx, user.jurisdiction, { operational: true });
  if (policy.settings.accountBasis === 'consent') {
    const consentDocument = await documentFor(tx, 'user-consent', policy.code);
    const last = await tx.consentEvent.findFirst({ where: { userId: user.id, type: 'privacy', basis: 'consent' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    if (!last || last.status !== 'granted' || last.documentId !== consentDocument.id || last.policyRevision !== policy.revision) throw new AppError(409, 'Подтвердите актуальное отдельное согласие в Privacy & Data.');
  }
  if (!input.offerAccepted || !input.refundAcknowledged) throw new AppError(400, 'Примите оферту и ознакомьтесь с правилами возврата.');
  const offer = await confirmDocument(tx, 'offer', policy.code, input.offerDocumentId);
  const refund = await confirmDocument(tx, 'refund-policy', policy.code, input.refundDocumentId);
  const event = await addDecision(tx, { userId: user.id, type: 'offer', status: 'accepted', basis: 'contract', policy, document: offer, confirmationMethod: 'checkout-checkbox' });
  return { jurisdiction: policy.code, policyRevision: policy.revision, offerDocumentId: offer.id, offerVersion: offer.version, refundDocumentId: refund.id, refundVersion: refund.version, receiptId: event.receiptId, acceptedAt: event.createdAt.toISOString() };
}
