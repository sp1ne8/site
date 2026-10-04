import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as controller from '../controllers/admin.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const empty = z.object({}).strict();
const id = z.string().uuid();
const idParams = z.object({ id }).strict();
const pageNumber = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(100000));
const pageSize = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(100));
const pagination = z.object({ page: pageNumber.default('1'), pageSize: pageSize.default('20') });
const listQuery = pagination.strict();
const date = z.string().datetime({ offset: true }).refine((value) => {
  const year = new Date(value).getUTCFullYear();
  return year >= 2000 && year <= 2200;
}, 'Укажите дату между 2000 и 2200 годом');
const money = z.union([z.string(), z.number().finite()]).transform(String)
  .pipe(z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, 'Сумма должна иметь не более двух знаков после запятой'));
const positiveMoney = money.refine((value) => Number(value) > 0, 'Значение должно быть больше нуля');
const image = z.string().trim().max(2048).refine((value) => {
  if (!value || (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\'))) return true;
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}, 'Изображение должно быть URL http(s) или локальным путём').nullable()
  .transform((value) => value || null);
const product = z.object({
  name: z.string().trim().min(1).max(150),
  slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(20000),
  shortDescription: z.string().trim().max(500),
  image: image.optional(),
  isActive: z.boolean().optional(),
}).strict();
const plan = z.object({
  productId: id,
  name: z.string().trim().min(1).max(100),
  durationDays: z.number().int().min(1).max(3650),
  price: money,
  isActive: z.boolean().optional(),
}).strict();
const promo = z.object({
  code: z.string().trim().toUpperCase().min(3).max(50).regex(/^[A-Z0-9_-]+$/),
  type: z.enum(['percent', 'fixed']),
  value: positiveMoney,
  maxUses: z.number().int().min(1).max(2147483647).nullable().optional(),
  expiresAt: date.nullable().optional(),
  isActive: z.boolean().optional(),
}).strict();
const nonEmpty = (schema) => schema.refine((data) => Object.keys(data).length > 0, 'Укажите хотя бы одно поле');
const list = (query = listQuery) => validate({ params: empty, query });
const create = (body) => validate({ params: empty, query: empty, body });
const update = (body) => validate({ params: idParams, query: empty, body });

router.get('/dashboard', validate({ params: empty, query: empty }), controller.dashboard);
router.get('/users', list(pagination.extend({ search: z.string().trim().max(160).optional() }).strict()), controller.users);
router.patch('/users/:id', update(nonEmpty(z.object({ isBlocked: z.boolean().optional(), role: z.enum(['user', 'admin']).optional() }).strict())), controller.updateUser);
router.get('/products', list(), controller.products);
router.post('/products', create(product), controller.createProduct);
router.patch('/products/:id', update(nonEmpty(product.partial())), controller.updateProduct);
router.delete('/products/:id', validate({ params: idParams, query: empty, body: empty.optional() }), controller.deactivateProduct);
router.get('/plans', list(pagination.extend({ productId: id.optional() }).strict()), controller.plans);
router.post('/plans', create(plan), controller.createPlan);
router.patch('/plans/:id', update(nonEmpty(plan.partial())), controller.updatePlan);
router.get('/promocodes', list(), controller.promos);
router.post('/promocodes', create(promo.refine((data) => data.type !== 'percent' || Number(data.value) <= 100, 'Процент скидки не может превышать 100')), controller.createPromo);
router.patch('/promocodes/:id', update(nonEmpty(promo.partial())), controller.updatePromo);
router.get('/orders', list(pagination.extend({
  status: z.enum(['pending', 'paid', 'cancelled', 'refunded']).optional(),
  userId: id.optional(), productId: id.optional(),
}).strict()), controller.orders);
router.get('/subscriptions', list(pagination.extend({
  status: z.enum(['active', 'expired', 'cancelled']).optional(),
  userId: id.optional(), productId: id.optional(),
}).strict()), controller.subscriptions);
router.post('/subscriptions', create(z.object({ userId: id, productId: id, planId: id, expiresAt: date }).strict()), controller.createSubscription);
router.patch('/subscriptions/:id', update(nonEmpty(z.object({ expiresAt: date.optional(), status: z.enum(['active', 'expired', 'cancelled']).optional() }).strict())), controller.updateSubscription);
router.get('/payments', list(pagination.extend({ status: z.enum(['pending', 'succeeded', 'cancelled', 'refunded']).optional() }).strict()), controller.payments);
router.get('/logs', list(), controller.logs);

export default router;
