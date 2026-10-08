import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { publicUserSelect } from '../utils/users.js';
import { serializable } from '../utils/transaction.js';
import { sendPasswordResetEmail } from './mail.service.js';
import { initializeLegal, registrationDecisions } from './legal.js';

const PASSWORD_COST = 12;
// A valid fixed hash keeps unknown-email logins on bcrypt's expensive path too.
const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxwOFZd8pmx/AkGxDVVho6uxN1K';
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

async function createSession(tx, userId) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 86_400_000);
  await tx.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

export async function register(input) {
  await initializeLegal();
  const { username, email, password } = input;
  const passwordHash = await bcrypt.hash(password, PASSWORD_COST);
  try {
    return await serializable(async (tx) => {
      const user = await tx.user.create({
        data: { username, email, passwordHash, role: 'user', jurisdiction: input.jurisdiction },
        select: publicUserSelect,
      });
      await registrationDecisions(tx, user.id, input);
      return { user, session: await createSession(tx, user.id) };
    });
  } catch (error) {
    if (error.code === 'P2002') throw new AppError(409, 'Этот email или логин уже используется.');
    throw error;
  }
}

export async function login({ email, password }) {
  const credentials = await prisma.user.findUnique({ where: { email } });
  const matches = await bcrypt.compare(password, credentials?.passwordHash || DUMMY_HASH);
  if (!credentials || !matches) throw new AppError(401, 'Неверный email или пароль.');
  return serializable(async (tx) => {
    const current = await tx.user.findUnique({ where: { id: credentials.id } });
    if (!current || current.passwordHash !== credentials.passwordHash) {
      throw new AppError(401, 'Неверный email или пароль.');
    }
    if (current.isBlocked || current.deletedAt) throw new AppError(403, 'Аккаунт заблокирован или закрыт.');
    await tx.session.deleteMany({ where: { userId: current.id, expiresAt: { lte: new Date() } } });
    const user = await tx.user.findUnique({ where: { id: current.id }, select: publicUserSelect });
    return { user, session: await createSession(tx, current.id) };
  });
}

export async function logout(sessionId) {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

export async function forgotPassword({ email }) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, isBlocked: true, deletedAt: true } });
  if (!user || user.isBlocked || user.deletedAt) return;
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const created = await serializable(async (tx) => {
    // Re-check the destination within the transaction so a concurrent profile
    // change cannot issue a new reset link to the user's former mailbox.
    const current = await tx.user.findUnique({ where: { id: user.id }, select: { email: true, isBlocked: true } });
    if (!current || current.email !== email || current.isBlocked) return false;
    await tx.passwordReset.deleteMany({ where: { userId: user.id } });
    await tx.passwordReset.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 30 * 60_000) },
    });
    return true;
  });
  if (!created) return;
  try {
    await sendPasswordResetEmail(email, token);
  } catch {
    // Do not expose account existence, SMTP details or reset tokens in API/logs.
    await prisma.passwordReset.deleteMany({ where: { tokenHash } });
    console.error('Password reset email could not be delivered. Check server mail configuration.');
  }
}

export async function resetPassword({ token, password }) {
  const tokenHash = hashToken(token);
  const passwordHash = await bcrypt.hash(password, PASSWORD_COST);
  await serializable(async (tx) => {
    const reset = await tx.passwordReset.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!reset || reset.usedAt || reset.expiresAt <= new Date() || reset.user.isBlocked || reset.user.deletedAt) {
      throw new AppError(400, 'Ссылка недействительна или срок её действия истёк.');
    }
    // Conditional claim plus the transaction makes parallel token replays single-use.
    const claimed = await tx.passwordReset.updateMany({
      where: { id: reset.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new AppError(400, 'Ссылка уже использована.');
    await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId: reset.userId } });
    await tx.passwordReset.updateMany({ where: { userId: reset.userId, usedAt: null }, data: { usedAt: new Date() } });
  });
}
