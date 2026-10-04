import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const schema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().startsWith('postgresql://'),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  SERVER_URL: z.string().url().default('http://localhost:3000'),
  PAYMENT_PROVIDER: z.literal('sandbox').default('sandbox'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(32),
  PAYMENT_API_KEY: z.string().optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  COOKIE_NAME: z.string().default('sid'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  SMTP_HOST: z.string().optional(), SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(), SMTP_PASS: z.string().optional(), SMTP_FROM: z.string().default('no-reply@example.test'),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@example.test'),
  SEED_ADMIN_PASSWORD: z.string().min(12).optional()
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) throw new Error(`Invalid environment: ${parsed.error.issues.map(i => i.path.join('.') + ': ' + i.message).join('; ')}`);
export const env = { ...parsed.data, COOKIE_SECURE: parsed.data.NODE_ENV === 'production' };
// This starter deliberately fails closed until a real provider adapter is installed.
if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'sandbox') {
  throw new Error('Sandbox payments are development-only. Implement and configure a real payment provider before production.');
}
