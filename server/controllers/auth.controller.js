import { env } from '../config/env.js';
import * as authService from '../services/auth.service.js';
import { PRIVACY_COOKIE, privacyCookieOptions } from '../services/legal.js';

export const cookieOptions = {
  httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax', path: '/',
};

export async function register(req, res) {
  const { user, session } = await authService.register(req.validated.body);
  res.cookie(env.COOKIE_NAME, session.token, { ...cookieOptions, expires: session.expiresAt });
  res.status(201).json({ success: true, data: user });
}

export async function login(req, res) {
  const { user, session } = await authService.login(req.validated.body);
  res.cookie(env.COOKIE_NAME, session.token, { ...cookieOptions, expires: session.expiresAt });
  res.json({ success: true, data: user });
}

export async function logout(req, res) {
  await authService.logout(req.sessionId);
  res.clearCookie(env.COOKIE_NAME, cookieOptions);
  res.clearCookie(PRIVACY_COOKIE, privacyCookieOptions);
  res.json({ success: true, data: { message: 'Вы вышли из аккаунта.' } });
}

export function me(req, res) {
  res.json({ success: true, data: req.user });
}

export async function forgotPassword(req, res) {
  await authService.forgotPassword(req.validated.body);
  res.json({ success: true, data: { message: 'Если аккаунт существует, письмо с инструкцией будет отправлено.' } });
}

export async function resetPassword(req, res) {
  await authService.resetPassword(req.validated.body);
  res.clearCookie(env.COOKIE_NAME, cookieOptions);
  res.json({ success: true, data: { message: 'Пароль изменён. Войдите снова.' } });
}
