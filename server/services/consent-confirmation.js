import { createHash } from 'node:crypto';
import { AppError } from '../utils/errors.js';
// A KZ-specific state/private service adapter can be registered on the backend.
// It must verify the subject, purpose and document on a trusted server channel.
// A frontend-provided ID alone never constitutes a verified confirmation.
const verifiers = new Map();
export function registerConsentVerifier(method, verify) {
  if (method === 'checkbox' || typeof verify !== 'function') throw new Error('Use a distinct server-side consent verifier.');
  verifiers.set(method, verify);
}
export const supportsConfirmation = method => method === 'checkbox' || verifiers.has(method);
export async function verifyConsentConfirmation(policy, input, userId) {
  const method = policy.settings.confirmationMethod;
  if (method === 'checkbox') return 'checkbox';
  const verifier = verifiers.get(method);
  if (!verifier) throw new AppError(409, 'Механизм подтверждения согласия для этой страны не подключён.');
  const result = await verifier({ userId, jurisdiction: policy.code, documentId: input.consentDocumentId, confirmationToken: input.confirmationToken });
  if (!result?.verified || typeof result.reference !== 'string' || !result.reference) throw new AppError(400, 'Подтверждение согласия не проверено сервером.');
  return `verified:${createHash('sha256').update(result.reference).digest('hex').slice(0, 24)}`;
}
