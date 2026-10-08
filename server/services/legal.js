import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { serializable } from '../utils/transaction.js';
import { DOCUMENTS, JURISDICTIONS, LEGAL_DATE, defaultSettings, draftBody } from '../../shared/legal.js';
import { verifyConsentConfirmation } from './consent-confirmation.js';

export const PRIVACY_COOKIE = 'hydra_privacy';
export const hashIdentifier = value => createHash('sha256').update(value).digest('hex');
export const privacyCookieOptions = { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax', path: '/' };
let initialization;
export function initializeLegal() {
  initialization ||= prisma.$transaction(async tx => {
    for (const code of Object.keys(JURISDICTIONS)) {
      await tx.jurisdictionPolicy.upsert({ where: { code }, create: { code, settings: defaultSettings(code) }, update: {} });
      for (const [kind, title] of Object.entries(DOCUMENTS)) {
        const version = `${LEGAL_DATE}-draft.1`;
        await tx.legalDocument.upsert({ where: { kind_jurisdiction_version: { kind, jurisdiction: code, version } }, create: { kind, jurisdiction: code, title, version, body: draftBody(kind, code) }, update: {} });
      }
    }
  }, { timeout: 20_000 }).catch(error => { initialization = null; throw error; });
  return initialization;
}
export async function documentFor(tx, kind, jurisdiction) {
  return await tx.legalDocument.findFirst({ where: { kind, jurisdiction, status: 'published' }, orderBy: { publishedAt: 'desc' } })
    || tx.legalDocument.findFirst({ where: { kind, jurisdiction, status: 'draft' }, orderBy: { createdAt: 'desc' } });
}
export async function checkedPolicy(tx, code, { operational = false } = {}) {
  const policy = await tx.jurisdictionPolicy.findUnique({ where: { code } });
  if (!policy || code === 'OTHER_CIS') throw new AppError(409, 'JURISDICTION_NOT_CONFIGURED');
  if (operational && env.NODE_ENV === 'production' && !policy.enabled) throw new AppError(409, 'Юридическая конфигурация страны ещё не опубликована.');
  return policy;
}
export async function confirmDocument(tx, kind, jurisdiction, id, { grant = true } = {}) {
  const document = await documentFor(tx, kind, jurisdiction);
  if (!document || (grant && document.id !== id)) throw new AppError(409, 'Версия юридического документа изменилась. Обновите страницу и ознакомьтесь с актуальной версией.');
  if (grant && env.NODE_ENV === 'production' && document.status !== 'published') throw new AppError(409, 'Юридический документ ещё не опубликован.');
  return document;
}
export async function addDecision(tx, { userId, anonymousHash, type, status, basis, policy, document, confirmationMethod = 'checkbox' }) {
  return tx.consentEvent.create({ data: {
    userId: userId || null, anonymousHash: userId ? null : anonymousHash,
    type, status, basis, jurisdiction: policy.code, policyRevision: policy.revision,
    documentId: document.id, documentVersion: document.version, confirmationMethod,
  } });
}
export async function registrationDecisions(tx, userId, input) {
  const policy = await checkedPolicy(tx, input.jurisdiction, { operational: true });
  const confirmationMethod = await verifyConsentConfirmation(policy, input, userId);
  const privacy = await confirmDocument(tx, 'personal-data-policy', policy.code, input.policyDocumentId);
  const terms = await confirmDocument(tx, 'terms', policy.code, input.termsDocumentId);
  if (!input.policyAcknowledged || !input.termsAccepted) throw new AppError(400, 'Необходимо ознакомиться с политикой и принять условия использования.');
  await addDecision(tx, { userId, type: 'privacy', status: 'acknowledged', basis: 'notice', policy, document: privacy });
  await addDecision(tx, { userId, type: 'terms', status: 'accepted', basis: 'contract', policy, document: terms });
  if (policy.settings.accountBasis === 'consent') {
    if (!input.privacyConsent) throw new AppError(400, 'Необходимо отдельное согласие для выбранной модели обработки аккаунта.');
    const document = await confirmDocument(tx, 'user-consent', policy.code, input.consentDocumentId);
    await addDecision(tx, { userId, type: 'privacy', status: 'granted', basis: 'consent', policy, document, confirmationMethod });
  }
  if (input.marketingConsent) throw new AppError(400, 'Маркетинговая рассылка не подключена. Согласие для неё сейчас не собирается.');
}
export async function mediaHosts(tx = prisma) {
  const products = await tx.product.findMany({ where: { isActive: true, image: { not: null } }, select: { image: true } });
  return [...new Set(products.flatMap(({ image }) => { try { const url = new URL(image); return ['http:', 'https:'].includes(url.protocol) ? [url.origin] : []; } catch { return []; } }))].sort();
}
export async function cookieInventory() {
  const externalMediaHosts = await mediaHosts();
  return {
    cookies: [
      { name: env.COOKIE_NAME, purpose: 'Авторизация и безопасность сеанса', provider: 'HYDRA', type: 'Essential', duration: `${env.SESSION_TTL_DAYS} дней; logout отзывает сеанс`, party: 'first-party', required: true, httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'Lax' },
      { name: PRIVACY_COOKIE, purpose: 'Сохранение решения о необязательных технологиях; только после выбора', provider: 'HYDRA', type: 'Essential', duration: 'Сессия браузера', party: 'first-party', required: true, httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'Lax' },
    ],
    storage: [{ name: 'checkout:*', purpose: 'IdempotencyKey повторного заказа', provider: 'HYDRA', type: 'Essential', duration: 'До успешного заказа / закрытия вкладки', party: 'first-party', required: true, storage: 'sessionStorage' }],
    externalMediaHosts,
    scopeVersion: hashIdentifier(JSON.stringify(externalMediaHosts)),
    inactiveCategories: ['Preferences', 'Analytics', 'Marketing'],
    externalCookies: 'Cookies внешних image-hosts не устанавливаются HYDRA. Их имена и сроки требуют аудита получателя; чужие cookie не удаляются интерфейсом HYDRA.',
  };
}
export async function publicBundle(code = 'RU') {
  await initializeLegal();
  const policy = await prisma.jurisdictionPolicy.findUnique({ where: { code } });
  if (!policy) throw new AppError(409, 'JURISDICTION_NOT_CONFIGURED');
  const documents = await Promise.all(Object.keys(DOCUMENTS).map(kind => documentFor(prisma, kind, code)));
  const inventory = await cookieInventory();
  const { reviewedBy, ...publicSettings } = policy.settings;
  return { jurisdiction: code, label: JURISDICTIONS[code], status: code === 'OTHER_CIS' ? 'JURISDICTION_NOT_CONFIGURED' : policy.enabled ? 'PUBLISHED_CONFIGURATION' : 'NEEDS_CONFIGURATION', revision: policy.revision, preview: env.NODE_ENV !== 'production', settings: publicSettings, documents, inventory,
    categories: { essential: true, preferences: false, analytics: false, marketing: false, thirdParty: code !== 'OTHER_CIS' && inventory.externalMediaHosts.length > 0 && (env.NODE_ENV !== 'production' || (policy.enabled && inventory.externalMediaHosts.every(host => policy.settings.externalMediaOrigins?.includes(host)))) },
  };
}
export async function optionalSubject(req, _res, next) {
  try {
    const token = req.cookies?.[env.COOKIE_NAME];
    if (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) {
      const session = await prisma.session.findUnique({ where: { tokenHash: hashIdentifier(token) }, include: { user: { select: { id: true, jurisdiction: true, isBlocked: true, deletedAt: true } } } });
      if (session?.expiresAt > new Date() && !session.user.isBlocked && !session.user.deletedAt) req.privacyUser = session.user;
    }
    const anonymous = req.cookies?.[PRIVACY_COOKIE];
    if (typeof anonymous === 'string' && /^[a-f0-9]{64}$/.test(anonymous)) req.anonymousHash = hashIdentifier(anonymous);
    next();
  } catch (error) { next(error); }
}
export function subjectWhere(req) {
  return req.privacyUser ? { userId: req.privacyUser.id } : req.anonymousHash ? { anonymousHash: req.anonymousHash } : null;
}
export async function consentState(req, jurisdiction) {
  const where = subjectWhere(req);
  const previous = !jurisdiction && where ? await prisma.consentEvent.findFirst({ where: { ...where, type: 'cookies' }, orderBy: { createdAt: 'desc' }, select: { jurisdiction: true } }) : null;
  const bundle = await publicBundle(req.privacyUser?.jurisdiction || jurisdiction || previous?.jurisdiction || 'RU');
  const history = where ? await prisma.consentEvent.findMany({ where: { ...where, jurisdiction: bundle.jurisdiction }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 }) : [];
  const latest = Object.fromEntries(history.reduce((map, item) => map.has(item.type) ? map : map.set(item.type, item), new Map()));
  const cookieDoc = bundle.documents.find(d => d.kind === 'cookie-policy');
  const valid = item => item?.documentId === cookieDoc?.id && item.policyRevision === bundle.revision && item.confirmationMethod === `cookie-settings:${bundle.inventory.scopeVersion.slice(0, 24)}`;
  return { jurisdiction: bundle.jurisdiction, hasDecision: valid(latest.cookies), choices: { essential: true, preferences: false, analytics: false, marketing: false, thirdParty: bundle.categories.thirdParty && valid(latest.third_party) && latest.third_party.status === 'granted' }, history };
}
export async function saveCookies(req, res, input) {
  await initializeLegal();
  const code = req.privacyUser?.jurisdiction || input.jurisdiction;
  if (input.jurisdiction !== code) throw new AppError(400, 'Для аккаунта используйте его юридическую конфигурацию.');
  const bundle = await publicBundle(code);
  if (input.preferences || input.analytics || input.marketing) throw new AppError(400, 'Эти необязательные технологии не подключены.');
  if (input.thirdParty && !bundle.categories.thirdParty) throw new AppError(400, 'Внешние технологии недоступны.');
  if (input.thirdParty && input.scopeVersion !== bundle.inventory.scopeVersion) throw new AppError(409, 'Состав внешних источников изменился. Обновите настройки и проверьте получателей.');
  const rawIdentifier = req.anonymousHash || req.privacyUser ? null : randomBytes(32).toString('hex');
  const anonymousHash = req.privacyUser ? null : req.anonymousHash || hashIdentifier(rawIdentifier);
  await serializable(async tx => {
    const policy = await tx.jurisdictionPolicy.findUnique({ where: { code } });
    if (!policy || policy.revision !== bundle.revision) throw new AppError(409, 'Юридическая конфигурация изменилась. Обновите настройки.');
    if (req.privacyUser) {
      const user = await tx.user.findUnique({ where: { id: req.privacyUser.id }, select: { jurisdiction: true, isBlocked: true, deletedAt: true } });
      if (!user || user.isBlocked || user.deletedAt || user.jurisdiction !== req.privacyUser.jurisdiction) throw new AppError(403, 'Аккаунт недоступен. Обновите страницу.');
    }
    const hosts = await mediaHosts(tx);
    const scopeVersion = hashIdentifier(JSON.stringify(hosts));
    if (input.thirdParty && (scopeVersion !== input.scopeVersion || (env.NODE_ENV === 'production' && (!policy.enabled || !hosts.every(host => policy.settings.externalMediaOrigins?.includes(host)))))) throw new AppError(409, 'Состав или разрешения внешних источников изменились. Обновите настройки.');
    const document = await confirmDocument(tx, 'cookie-policy', code, input.documentId, { grant: input.thirdParty });
    const subject = { userId: req.privacyUser?.id, anonymousHash, policy, document, confirmationMethod: `cookie-settings:${scopeVersion.slice(0, 24)}` };
    await addDecision(tx, { ...subject, type: 'cookies', status: 'acknowledged', basis: 'technical-preference' });
    for (const [type, chosen] of [['third_party', input.thirdParty], ['analytics', false], ['marketing', false]]) {
      await addDecision(tx, { ...subject, type, status: chosen ? 'granted' : 'withdrawn', basis: 'consent' });
    }
  });
  if (rawIdentifier) { res.cookie(PRIVACY_COOKIE, rawIdentifier, privacyCookieOptions); req.anonymousHash = anonymousHash; }
  return consentState(req, code);
}
