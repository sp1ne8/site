import { readdir, stat, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { prisma } from '../config/db.js';
export async function cleanupPrivateMail() {
  const directory = fileURLToPath(new URL('../storage/mail-outbox/', import.meta.url));
  let files;
  try { files = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  let removed = 0;
  for (const name of files) {
    if (!/^\d+-[a-f0-9-]+\.json$/.test(name)) continue;
    const path = join(directory, name);
    const info = await stat(path);
    if (info.isFile() && info.mtimeMs < Date.now() - 30 * 60_000) { await unlink(path); removed++; }
  }
  return removed;
}
export async function retentionMaintenance({ dryRun = false } = {}) {
  const policies = await prisma.jurisdictionPolicy.findMany();
  const result = { consents: 0, requests: 0, overdueHolds: await prisma.retentionHold.count({ where: { reviewAt: { lte: new Date() } } }), mail: 0, unconfigured: [] };
  for (const policy of policies) {
    const { consentsDays, requestsDays } = policy.settings.retention;
    if (!policy.enabled || !consentsDays || !requestsDays) { result.unconfigured.push(policy.code); continue; }
    // Keep account proofs of an active contract and all records under a hold.
    const consentsWhere = { jurisdiction: policy.code, createdAt: { lt: new Date(Date.now() - consentsDays * 86_400_000) }, OR: [{ userId: null }, { user: { deletedAt: null, retentionHolds: { none: {} } }, type: { notIn: ['privacy', 'terms', 'offer'] } }] };
    const requestsWhere = { jurisdiction: policy.code, status: { in: ['fulfilled', 'rejected'] }, resolvedAt: { lt: new Date(Date.now() - requestsDays * 86_400_000) }, user: { retentionHolds: { none: {} } } };
    if (dryRun) {
      result.consents += await prisma.consentEvent.count({ where: consentsWhere });
      result.requests += await prisma.dataRequest.count({ where: requestsWhere });
    } else {
      result.consents += (await prisma.consentEvent.deleteMany({ where: consentsWhere })).count;
      result.requests += (await prisma.dataRequest.deleteMany({ where: requestsWhere })).count;
    }
  }
  if (!dryRun) result.mail = await cleanupPrivateMail();
  // Financial/account holds are reviewed by the operator, never blindly erased.
  return result;
}
