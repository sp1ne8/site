import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { asyncHandler as a } from '../utils/async.js';
import * as legal from '../services/legal.js';
import * as privacy from '../services/privacy.js';
import * as admin from '../services/legal-admin.js';
import { JURISDICTIONS, DOCUMENTS } from '../../shared/legal.js';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
const country = z.enum(Object.keys(JURISDICTIONS));
const uuid = z.string().uuid();
const empty = z.object({}).strict();
const paging = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), jurisdiction: country.optional(), status: z.enum(['draft', 'published', 'archived', 'pending', 'in_review', 'fulfilled', 'rejected']).optional() }).strict();
const write = body => validate({ body, query: empty, params: empty });
const read = query => validate({ query, params: empty });
const send = fn => a(async (req, res) => res.json({ success: true, data: await fn(req, res) }));
export const registrationLegalSchema = {
  jurisdiction: country, policyAcknowledged: z.literal(true), termsAccepted: z.literal(true),
  policyDocumentId: uuid, termsDocumentId: uuid, privacyConsent: z.boolean().default(false), consentDocumentId: uuid.optional(), marketingConsent: z.boolean().default(false),
  confirmationToken: z.string().min(1).max(500).optional(),
};
export const orderLegalSchema = { offerAccepted: z.literal(true), refundAcknowledged: z.literal(true), offerDocumentId: uuid, refundDocumentId: uuid };
export const legalRoutes = Router();
legalRoutes.get('/config', read(z.object({ jurisdiction: country.default('RU') }).strict()), send(req => legal.publicBundle(req.validated.query.jurisdiction)));
legalRoutes.get('/documents/:id', validate({ params: z.object({ id: uuid }).strict(), query: empty }), send(async req => {
  const document = await prisma.legalDocument.findUnique({ where: { id: req.validated.params.id } });
  if (!document || (document.status === 'draft' && env.NODE_ENV === 'production')) throw new AppError(404, 'Документ не найден.');
  return document;
}));
legalRoutes.get('/consents', legal.optionalSubject, read(z.object({ jurisdiction: country.optional() }).strict()), send(req => legal.consentState(req, req.validated.query.jurisdiction)));
legalRoutes.post('/consents/cookies', legal.optionalSubject, rateLimit({ windowMs: 60_000, limit: 30 }), write(z.object({ jurisdiction: country, documentId: uuid, scopeVersion: z.string().regex(/^[a-f0-9]{64}$/), preferences: z.boolean(), analytics: z.boolean(), marketing: z.boolean(), thirdParty: z.boolean() }).strict()), send((req, res) => legal.saveCookies(req, res, req.validated.body)));

export const privacyRoutes = Router();
privacyRoutes.use(requireAuth);
privacyRoutes.get('/', read(empty), send(req => privacy.privacyOverview(req.user.id)));
privacyRoutes.get('/export', rateLimit({ windowMs: 60_000, limit: 6 }), read(empty), send(req => privacy.exportData(req.user.id)));
privacyRoutes.post('/requests', rateLimit({ windowMs: 60_000, limit: 10 }), write(z.object({ type: z.enum(['deletion', 'correction', 'export', 'withdrawal', 'other']), message: z.string().trim().max(4000).default(''), currentPassword: z.string().max(72).optional() }).strict()), send(req => privacy.createDataRequest(req.user.id, req.validated.body)));
privacyRoutes.post('/consents/withdraw', write(z.object({ type: z.enum(['privacy', 'marketing', 'analytics', 'third_party']) }).strict()), send(req => privacy.withdrawConsent(req.user.id, req.validated.body.type)));
privacyRoutes.post('/acknowledge', write(z.object({ jurisdiction: country, policyAcknowledged: z.literal(true), policyDocumentId: uuid, privacyConsent: z.boolean().default(false), consentDocumentId: uuid.optional(), confirmationToken: z.string().min(1).max(500).optional() }).strict()), send(req => privacy.confirmAccountPolicy(req.user.id, req.validated.body)));

export const legalAdminRoutes = Router();
legalAdminRoutes.use(requireAuth, requireAdmin);
const idParams = z.object({ id: uuid }).strict();
const text = z.string().trim().min(1).max(10000);
const operator = z.object(Object.fromEntries(['company', 'name', 'registration', 'address', 'email', 'phone', 'country'].map(key => [key, z.string().trim().min(1).max(500)]))).strict();
const settings = z.object({
  operator, accountBasis: z.enum(['contract', 'consent']), confirmationMethod: z.enum(['checkbox', 'external-verification']), notice: text, withdrawal: text, requestProcedure: text,
  requestDays: z.number().int().min(1).max(365).nullable(),
  retention: z.object({ account: text, financial: text, consents: text, requests: text, logs: text, backups: text, consentsDays: z.number().int().min(1).max(36500).nullable(), requestsDays: z.number().int().min(1).max(36500).nullable() }).strict(),
  infrastructure: z.object(Object.fromEntries(['backend', 'database', 'backups', 'email', 'payment', 'cdn'].map(key => [key, text]))).strict(),
  transfers: text, paymentTerms: text, refundRules: text, reviewedBy: z.string().trim().max(500), reviewedAt: z.string().datetime({ offset: true }).nullable(),
  externalMediaOrigins: z.array(z.string().url().refine(value => new URL(value).protocol === 'https:' && new URL(value).origin === value, 'Укажите HTTPS origin без пути')).max(100).default([]),
}).strict();
legalAdminRoutes.get('/:resource', validate({ params: z.object({ resource: z.enum(['documents', 'consents', 'requests', 'logs', 'jurisdictions', 'holds', 'cookies']) }).strict(), query: paging }), send(req => req.validated.params.resource === 'cookies' ? legal.cookieInventory() : admin.legalList(req.validated.params.resource, req.validated.query)));
legalAdminRoutes.get('/documents/:id/history', validate({ params: idParams, query: empty }), send(req => admin.documentHistory(req.validated.params.id)));
legalAdminRoutes.post('/documents', write(z.object({ kind: z.enum(Object.keys(DOCUMENTS)), jurisdiction: country, title: z.string().trim().min(1).max(200), version: z.string().trim().min(1).max(80), body: z.string().trim().min(50).max(50000) }).strict()), send(req => admin.saveDocument(req.user.id, req.validated.body)));
legalAdminRoutes.patch('/documents/:id', validate({ params: idParams, query: empty, body: z.object({ title: z.string().trim().min(1).max(200), body: z.string().trim().min(50).max(50000) }).strict() }), send(req => admin.editDocument(req.user.id, req.validated.params.id, req.validated.body)));
legalAdminRoutes.post('/documents/:id/publish', validate({ params: idParams, query: empty, body: z.object({ legallyReviewed: z.literal(true) }).strict() }), send(req => admin.publishDocument(req.user.id, req.validated.params.id)));
legalAdminRoutes.patch('/jurisdictions/:code', validate({ params: z.object({ code: country }).strict(), query: empty, body: z.object({ revision: z.number().int().min(1), enabled: z.boolean(), settings }).strict() }), send(req => admin.saveJurisdiction(req.user.id, req.validated.params.code, req.validated.body)));
legalAdminRoutes.patch('/requests/:id', validate({ params: idParams, query: empty, body: z.object({ status: z.enum(['in_review', 'fulfilled', 'rejected']), response: z.string().trim().max(5000), dueAt: z.string().datetime({ offset: true }).optional() }).strict() }), send(req => admin.updateRequest(req.user.id, req.validated.params.id, req.validated.body)));
legalAdminRoutes.post('/requests/:id/close-account', validate({ params: idParams, query: empty, body: z.object({ basis: z.string().trim().min(10).max(3000), reviewAt: z.string().datetime({ offset: true }), response: z.string().trim().min(10).max(3000), reviewed: z.literal(true) }).strict() }), send(req => admin.closeAccount(req.user.id, req.validated.params.id, req.validated.body)));
