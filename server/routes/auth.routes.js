import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async.js';
import * as controller from '../controllers/auth.controller.js';
import { registrationLegalSchema } from './legal.routes.js';
import { usernameSchema, emailSchema, passwordSchema, currentPasswordSchema, emptySchema, withMatchingPasswords } from '../utils/auth.schemas.js';

const router = Router();
const limit = (max) => rateLimit({
  windowMs: 15 * 60_000,
  limit: max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Слишком много попыток. Повторите через 15 минут.' }),
});
const credentialsLimit = limit(20);
const resetLimit = limit(8);
const validated = (body) => validate({ body, query: emptySchema, params: emptySchema });

router.post('/register', credentialsLimit, validated(withMatchingPasswords(z.object({
  username: usernameSchema, email: emailSchema, password: passwordSchema, confirmPassword: z.string().max(72),
  ...registrationLegalSchema,
}).strict())), asyncHandler(controller.register));
router.post('/login', credentialsLimit, validated(z.object({ email: emailSchema, password: currentPasswordSchema }).strict()), asyncHandler(controller.login));
router.post('/logout', validated(emptySchema), requireAuth, asyncHandler(controller.logout));
router.get('/me', validated(emptySchema.optional()), requireAuth, controller.me);
router.post('/forgot-password', resetLimit, validated(z.object({ email: emailSchema }).strict()), asyncHandler(controller.forgotPassword));
router.post('/reset-password', resetLimit, validated(withMatchingPasswords(z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/), password: passwordSchema, confirmPassword: z.string().max(72),
}).strict())), asyncHandler(controller.resetPassword));

export default router;
