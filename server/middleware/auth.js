import { createHash } from 'node:crypto';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { asyncHandler } from '../utils/async.js';
import { publicUserSelect } from '../utils/users.js';

export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[env.COOKIE_NAME];
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    throw new AppError(401, 'Необходимо войти в аккаунт.');
  }
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: { select: publicUserSelect } },
  });
  if (!session || session.expiresAt <= new Date()) {
    res.clearCookie(env.COOKIE_NAME, {
      httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax', path: '/',
    });
    if (session) await prisma.session.deleteMany({ where: { id: session.id } });
    throw new AppError(401, 'Сессия истекла. Войдите снова.');
  }
  // Resolve role and blocked status from the database on every request.
  if (session.user.isBlocked || session.user.deletedAt) {
    await prisma.session.deleteMany({ where: { userId: session.user.id } });
    res.clearCookie(env.COOKIE_NAME, {
      httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax', path: '/',
    });
    throw new AppError(403, 'Аккаунт заблокирован.');
  }
  req.user = session.user;
  req.sessionId = session.id;
  next();
});

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(new AppError(401, 'Необходимо войти в аккаунт.'));
  if (req.user.isBlocked || req.user.role !== 'admin') {
    return next(new AppError(403, 'Доступ разрешён только администратору.'));
  }
  next();
}
