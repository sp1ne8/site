import { prisma } from '../config/db.js';
import { AppError } from '../utils/errors.js';
import { serializable } from '../utils/transaction.js';
import { initializeLegal } from './legal.js';
import { DOCUMENTS } from '../../shared/legal.js';
import { cancelPending } from './orders.js';
import { supportsConfirmation } from './consent-confirmation.js';

const log = (tx, adminId, action, entity, entityId, details = {}) => tx.adminLog.create({ data: { adminId, action, entity, entityId, details } });
async function mutate(adminId, operation) {
  await initializeLegal();
  return serializable(async tx => {
    const actor = await tx.user.findUnique({ where: { id: adminId }, select: { role: true, isBlocked: true, deletedAt: true } });
    if (!actor || actor.role !== 'admin' || actor.isBlocked || actor.deletedAt) throw new AppError(403, 'Требуются действующие права администратора.');
    return operation(tx);
  });
}
export async function legalList(resource, { page = 1, pageSize = 20, jurisdiction, status }) {
  await initializeLegal();
  const model = { documents: prisma.legalDocument, consents: prisma.consentEvent, requests: prisma.dataRequest, logs: prisma.adminLog, jurisdictions: prisma.jurisdictionPolicy, holds: prisma.retentionHold }[resource];
  const where = { ...(jurisdiction && resource !== 'logs' && resource !== 'holds' ? resource === 'jurisdictions' ? { code: jurisdiction } : { jurisdiction } : {}), ...(status && ['documents', 'requests'].includes(resource) ? { status } : {}) };
  const include = resource === 'documents' ? { _count: { select: { consentEvents: true } } } : ['consents', 'requests', 'holds'].includes(resource) ? { user: { select: { id: true, username: true, email: true, deletedAt: true } } } : undefined;
  const orderBy = resource === 'jurisdictions' ? { code: 'asc' } : [{ createdAt: 'desc' }, { id: 'desc' }];
  const [items, total] = await prisma.$transaction([model.findMany({ where, include, orderBy, take: pageSize, skip: (page - 1) * pageSize }), model.count({ where })]);
  return { items, total, page, pageSize };
}
export async function saveDocument(adminId, input) {
  return mutate(adminId, async tx => {
    const document = await tx.legalDocument.create({ data: { kind: input.kind, jurisdiction: input.jurisdiction, title: input.title || DOCUMENTS[input.kind], version: input.version, body: input.body, status: 'draft' } });
    await log(tx, adminId, 'legal.document.create', 'LegalDocument', document.id, { kind: document.kind, version: document.version, jurisdiction: document.jurisdiction });
    return document;
  });
}
export async function editDocument(adminId, id, input) {
  return mutate(adminId, async tx => {
    const document = await tx.legalDocument.findUnique({ where: { id } });
    if (!document) throw new AppError(404, 'Документ не найден.');
    if (document.status !== 'draft' || await tx.consentEvent.count({ where: { documentId: id } })) throw new AppError(409, 'Опубликованные или уже подтверждённые версии неизменяемы. Создайте новую версию.');
    const updated = await tx.legalDocument.update({ where: { id }, data: input });
    await log(tx, adminId, 'legal.document.edit', 'LegalDocument', id, { fields: Object.keys(input), version: updated.version, before: { title: document.title, body: document.body }, after: { title: updated.title, body: updated.body } });
    return updated;
  });
}
export function documentHistory(id) {
  return prisma.adminLog.findMany({ where: { entity: 'LegalDocument', entityId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
}
function hasPlaceholders(value) {
  if (typeof value === 'string') return /\[[A-ZА-ЯЁ][A-ZА-ЯЁ0-9 /_,.—()-]*\]/u.test(value);
  if (value && typeof value === 'object') return Object.values(value).some(hasPlaceholders);
  return false;
}
function configured(settings) {
  if (hasPlaceholders(settings)) throw new AppError(409, 'Заполните реквизиты, сроки, размещение, передачи и договорные правила; placeholders нельзя публиковать.');
  if (!settings.reviewedBy || !settings.reviewedAt) throw new AppError(409, 'Укажите ответственного за юридическую проверку и её дату.');
  if (!supportsConfirmation(settings.confirmationMethod)) throw new AppError(409, 'Адаптер дополнительного подтверждения ещё не реализован.');
  if (!settings.operator.email.includes('@')) throw new AppError(400, 'Укажите email оператора.');
  if (!settings.requestDays || !settings.retention.consentsDays || !settings.retention.requestsDays) throw new AppError(409, 'Настройте утверждённые сроки ответа и хранения доказательных записей.');
}
export async function publishDocument(adminId, id) {
  return mutate(adminId, async tx => {
    const document = await tx.legalDocument.findUnique({ where: { id } });
    if (!document || document.status !== 'draft') throw new AppError(409, 'Публиковать можно только новый проект документа.');
    if (document.jurisdiction === 'OTHER_CIS') throw new AppError(409, 'JURISDICTION_NOT_CONFIGURED');
    if (hasPlaceholders(document.body)) throw new AppError(409, 'В документе остались незаполненные placeholders.');
    const policy = await tx.jurisdictionPolicy.findUnique({ where: { code: document.jurisdiction } });
    configured(policy.settings);
    await tx.legalDocument.updateMany({ where: { kind: document.kind, jurisdiction: document.jurisdiction, status: 'published' }, data: { status: 'archived' } });
    const updated = await tx.legalDocument.update({ where: { id }, data: { status: 'published', publishedAt: new Date() } });
    await log(tx, adminId, 'legal.document.publish', 'LegalDocument', id, { version: updated.version, jurisdiction: document.jurisdiction });
    return updated;
  });
}
export async function saveJurisdiction(adminId, code, input) {
  return mutate(adminId, async tx => {
    const previous = await tx.jurisdictionPolicy.findUnique({ where: { code } });
    if (!previous) throw new AppError(404, 'Юрисдикция не найдена.');
    if (input.revision !== previous.revision) throw new AppError(409, 'Конфигурацию изменили. Обновите страницу.');
    if (code === 'OTHER_CIS' && input.enabled) throw new AppError(409, 'JURISDICTION_NOT_CONFIGURED');
    if (input.enabled) {
      configured(input.settings);
      for (const kind of Object.keys(DOCUMENTS).filter(kind => kind !== 'marketing-consent')) {
        if (!await tx.legalDocument.findFirst({ where: { kind, jurisdiction: code, status: 'published' } })) throw new AppError(409, 'Сначала опубликуйте все основные документы этой страны.');
      }
    }
    const updated = await tx.jurisdictionPolicy.update({ where: { code }, data: { settings: input.settings, enabled: input.enabled, revision: { increment: 1 } } });
    await log(tx, adminId, 'legal.jurisdiction.update', 'JurisdictionPolicy', code, { previousRevision: previous.revision, revision: updated.revision, enabled: updated.enabled });
    return updated;
  });
}
export async function updateRequest(adminId, id, input) {
  return mutate(adminId, async tx => {
    const request = await tx.dataRequest.findUnique({ where: { id } });
    if (!request) throw new AppError(404, 'Запрос не найден.');
    if (['fulfilled', 'rejected'].includes(request.status)) throw new AppError(409, 'Обращение уже завершено. Историю нельзя переписать.');
    if (request.type === 'deletion' && input.status === 'fulfilled') throw new AppError(409, 'Используйте отдельное закрытие аккаунта с основанием сохраняемых записей.');
    const terminal = ['fulfilled', 'rejected'].includes(input.status);
    if (terminal && !input.response.trim()) throw new AppError(400, 'Нужен содержательный ответ пользователю.');
    const updated = await tx.dataRequest.update({ where: { id }, data: { status: input.status, response: input.response, dueAt: input.dueAt ? new Date(input.dueAt) : request.dueAt, resolvedAt: terminal ? new Date() : null } });
    await log(tx, adminId, 'privacy.request.update', 'DataRequest', id, { previousStatus: request.status, status: updated.status });
    return updated;
  });
}
export async function closeAccount(adminId, requestId, input) {
  return mutate(adminId, async tx => {
    const request = await tx.dataRequest.findUnique({ where: { id: requestId }, include: { user: true } });
    if (!request || request.type !== 'deletion') throw new AppError(400, 'Нужен запрос пользователя на удаление.');
    if (!['pending', 'in_review'].includes(request.status) || request.user.deletedAt) throw new AppError(409, 'Запрос уже обработан.');
    if (request.userId === adminId || request.user.role === 'admin') throw new AppError(409, 'Закрытие административного аккаунта требует предварительного переноса обязанностей и снятия роли.');
    const reviewAt = new Date(input.reviewAt);
    if (reviewAt <= new Date()) throw new AppError(400, 'Укажите будущую конечную дату проверки/удаления сохраняемых записей.');
    const userId = request.userId;
    const pendingOrders = await tx.order.findMany({ where: { userId, status: 'pending' } });
    for (const order of pendingOrders) await cancelPending(tx, order);
    await tx.session.deleteMany({ where: { userId } });
    await tx.passwordReset.deleteMany({ where: { userId } });
    await tx.subscription.updateMany({ where: { userId, status: 'active' }, data: { status: 'cancelled' } });
    await tx.user.update({ where: { id: userId }, data: { username: `closed_${userId.replaceAll('-', '')}`, email: `closed-${userId}@invalid.test`, passwordHash: '', isBlocked: true, privacyRestricted: true, deletedAt: new Date() } });
    const categories = ['orders', 'payments', 'subscriptions', 'legal_receipts', 'requests', 'audit_logs', 'account_reference'];
    await tx.retentionHold.create({ data: { userId, requestId, categories, basis: input.basis, reviewAt } });
    const response = `${input.response}\nАккаунт закрыт, доступ и активные сеансы прекращены. Email, username и password hash убраны из действующего профиля. Сохраняемые записи: ${categories.join(', ')}. Основание: ${input.basis}. Проверка прекращения хранения: ${reviewAt.toISOString()}. Связанные записи пока не физически уничтожены; это ограничение обработки и псевдонимизация.`;
    await tx.dataRequest.update({ where: { id: requestId }, data: { status: 'fulfilled', response, resolvedAt: new Date() } });
    await log(tx, adminId, 'privacy.account.close', 'User', userId, { requestId, categories, reviewAt: reviewAt.toISOString() });
    return { closed: true, response, categories, reviewAt };
  });
}
