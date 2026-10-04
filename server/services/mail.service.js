import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export async function sendPasswordResetEmail(email, token) {
  const resetUrl = new URL('/reset-password', env.CLIENT_URL);
  resetUrl.searchParams.set('token', token);
  const mail = {
    from: env.SMTP_FROM || 'no-reply@example.test',
    to: email,
    subject: 'Восстановление пароля',
    text: `Для смены пароля откройте ссылку (действует 30 минут):\n\n${resetUrl.toString()}\n\nЕсли вы не запрашивали смену пароля, проигнорируйте письмо.`,
  };
  if (env.SMTP_HOST) {
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    await transport.sendMail(mail);
    return;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('SMTP is required for password reset delivery in production.');
  }
  // Development outbox is private server storage, never mounted as static files.
  const directory = fileURLToPath(new URL('../storage/mail-outbox/', import.meta.url));
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/${Date.now()}-${randomUUID()}.json`, JSON.stringify(mail, null, 2), {
    encoding: 'utf8', mode: 0o600, flag: 'wx',
  });
}
