import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async.js';
import * as controller from '../controllers/user.controller.js';
import { usernameSchema, emailSchema, passwordSchema, currentPasswordSchema, emptySchema, withMatchingPasswords } from '../utils/auth.schemas.js';

const router = Router();
const profileLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Слишком много попыток. Повторите позже.' }),
});
const validated = (body) => validate({ body, query: emptySchema, params: emptySchema });
router.use(requireAuth);
router.get('/me', validated(emptySchema.optional()), controller.me);
router.patch('/me', profileLimit, validated(z.object({
  username: usernameSchema, email: emailSchema, currentPassword: currentPasswordSchema,
}).strict()), asyncHandler(controller.updateProfile));
router.patch('/me/password', profileLimit, validated(withMatchingPasswords(z.object({
  currentPassword: currentPasswordSchema, password: passwordSchema, confirmPassword: z.string().max(72),
}).strict())), asyncHandler(controller.changePassword));

export default router;
