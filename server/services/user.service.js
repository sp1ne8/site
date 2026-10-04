import bcrypt from 'bcrypt';
import { prisma } from '../config/db.js';
import { AppError } from '../utils/errors.js';
import { publicUserSelect } from '../utils/users.js';
import { serializable } from '../utils/transaction.js';

async function verifyPassword(userId, password) {
  const credentials = await prisma.user.findUnique({ where: { id: userId } });
  if (!credentials || credentials.isBlocked) throw new AppError(403, 'Аккаунт недоступен.');
  if (!(await bcrypt.compare(password, credentials.passwordHash))) {
    throw new AppError(400, 'Текущий пароль указан неверно.');
  }
  return credentials;
}

async function ensureUnchanged(tx, credentials) {
  const current = await tx.user.findUnique({ where: { id: credentials.id } });
  if (!current || current.isBlocked || current.passwordHash !== credentials.passwordHash) {
    throw new AppError(401, 'Данные аккаунта изменились. Войдите снова.');
  }
  return current;
}

export async function updateProfile(userId, { username, email, currentPassword }) {
  const credentials = await verifyPassword(userId, currentPassword);
  try {
    return await serializable(async (tx) => {
      const current = await ensureUnchanged(tx, credentials);
      const user = await tx.user.update({ where: { id: userId }, data: { username, email }, select: publicUserSelect });
      // A reset delivered to an old mailbox must no longer work after email changes.
      if (email !== current.email) await tx.passwordReset.deleteMany({ where: { userId } });
      return user;
    });
  } catch (error) {
    if (error.code === 'P2002') throw new AppError(409, 'Этот email или логин уже используется.');
    throw error;
  }
}

export async function changePassword(userId, { currentPassword, password }) {
  const credentials = await verifyPassword(userId, currentPassword);
  const passwordHash = await bcrypt.hash(password, 12);
  await serializable(async (tx) => {
    await ensureUnchanged(tx, credentials);
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId } });
    await tx.passwordReset.deleteMany({ where: { userId } });
  });
}
