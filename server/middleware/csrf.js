import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
const allowed = new Set([new URL(env.CLIENT_URL).origin, new URL(env.SERVER_URL).origin]);
export function csrfProtection(req, res, next) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  // Non-simple header forces a CORS preflight; SameSite cookie adds a second barrier.
  if (req.get('X-Requested-With') !== 'XMLHttpRequest') return next(new AppError(403, 'Отсутствует защитный заголовок запроса'));
  if (req.get('origin') && !allowed.has(req.get('origin'))) return next(new AppError(403, 'Недопустимый источник запроса'));
  if (req.get('sec-fetch-site') === 'cross-site') return next(new AppError(403, 'Межсайтовый запрос запрещён'));
  next();
}
