import { env } from '../config/env.js';
import { cookieOptions } from './auth.controller.js';
import * as userService from '../services/user.service.js';

export function me(req, res) {
  res.json({ success: true, data: req.user });
}

export async function updateProfile(req, res) {
  const user = await userService.updateProfile(req.user.id, req.validated.body);
  res.json({ success: true, data: user });
}

export async function changePassword(req, res) {
  await userService.changePassword(req.user.id, req.validated.body);
  res.clearCookie(env.COOKIE_NAME, cookieOptions);
  res.json({ success: true, data: { message: 'Пароль изменён. Войдите снова.' } });
}
