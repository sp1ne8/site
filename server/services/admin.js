import { prisma } from '../config/db.js';
import { AppError } from '../utils/errors.js';
import { publicUserSelect } from '../utils/users.js';
import { serializable } from '../utils/transaction.js';

const actorSelect = { id: true, username: true, role: true };
const saleInclude = { user: { select: publicUserSelect }, product: true, plan: true };
const notFound = (value, name) => {
  if (!value) throw new AppError(404, `${name} не найден`);
  return value;
};
const audit = (tx, adminId, action, entity, entityId, details = {}) => tx.adminLog.create({
  data: { adminId, action, entity, entityId, details },
});
const mutate = (adminId, operation) => serializable(async (tx) => {
  // Recheck authorization in the transaction: another administrator may revoke access.
  const actor = await tx.user.findUnique({ where: { id: adminId }, select: { role: true, isBlocked: true } });
  if (!actor || actor.role !== 'admin' || actor.isBlocked) throw new AppError(403, 'Требуются права администратора');
  return operation(tx);
});
const paged = async (model, query, args = {}) => {
  const { page, pageSize } = query;
  const [items, total] = await prisma.$transaction([
    model.findMany({ ...args, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    model.count({ where: args.where }),
  ]);
  return { items, total, page, pageSize };
};

export async function dashboard() {
  const [users, activeSubscriptions, orders, paidOrders, revenue] = await prisma.$transaction([
    prisma.user.count(),
    prisma.subscription.count({ where: { status: 'active', expiresAt: { gt: new Date() } } }),
    prisma.order.count(),
    prisma.order.count({ where: { status: 'paid' } }),
    prisma.order.aggregate({ where: { status: 'paid' }, _sum: { finalPrice: true } }),
  ]);
  return { users, activeSubscriptions, orders, paidOrders, totalRevenue: revenue._sum.finalPrice?.toFixed(2) || '0.00' };
}

export function listUsers(query) {
  const where = query.search ? { OR: [
    { username: { contains: query.search, mode: 'insensitive' } },
    { email: { contains: query.search, mode: 'insensitive' } },
  ] } : {};
  return paged(prisma.user, query, { where, select: publicUserSelect });
}

export function updateUser(adminId, id, data) {
  return mutate(adminId, async (tx) => {
    const user = notFound(await tx.user.findUnique({ where: { id }, select: publicUserSelect }), 'Пользователь');
    if (adminId === id && (data.isBlocked === true || data.role === 'user')) {
      throw new AppError(409, 'Нельзя заблокировать себя или снять собственную роль администратора');
    }
    const losesAdminAccess = user.role === 'admin' && !user.isBlocked && (data.isBlocked === true || data.role === 'user');
    if (losesAdminAccess && await tx.user.count({ where: { role: 'admin', isBlocked: false } }) <= 1) {
      throw new AppError(409, 'Нельзя отключить последнего активного администратора');
    }
    const updated = await tx.user.update({ where: { id }, data, select: publicUserSelect });
    if (data.isBlocked === true || (data.role && data.role !== user.role)) {
      await tx.session.deleteMany({ where: { userId: id } });
    }
    if (data.isBlocked === true) await tx.passwordReset.deleteMany({ where: { userId: id } });
    await audit(tx, adminId, 'user.update', 'User', id, { fields: Object.keys(data), role: updated.role, isBlocked: updated.isBlocked });
    return updated;
  });
}

export const listProducts = (query) => paged(prisma.product, query, { include: { plans: { orderBy: { durationDays: 'asc' } } } });

export function createProduct(adminId, _id, data) {
  return mutate(adminId, async (tx) => {
    const product = await tx.product.create({ data });
    await audit(tx, adminId, 'product.create', 'Product', product.id, { fields: Object.keys(data) });
    return product;
  });
}

export function updateProduct(adminId, id, data) {
  return mutate(adminId, async (tx) => {
    notFound(await tx.product.findUnique({ where: { id }, select: { id: true } }), 'Продукт');
    const product = await tx.product.update({ where: { id }, data });
    await audit(tx, adminId, 'product.update', 'Product', id, { fields: Object.keys(data) });
    return product;
  });
}

export function deactivateProduct(adminId, id) {
  return mutate(adminId, async (tx) => {
    notFound(await tx.product.findUnique({ where: { id }, select: { id: true } }), 'Продукт');
    const product = await tx.product.update({ where: { id }, data: { isActive: false } });
    await tx.plan.updateMany({ where: { productId: id }, data: { isActive: false } });
    await audit(tx, adminId, 'product.deactivate', 'Product', id);
    return product;
  });
}

export const listPlans = (query) => paged(prisma.plan, query, { where: query.productId ? { productId: query.productId } : {}, include: { product: true } });

export function createPlan(adminId, _id, data) {
  return mutate(adminId, async (tx) => {
    notFound(await tx.product.findUnique({ where: { id: data.productId }, select: { id: true } }), 'Продукт');
    const plan = await tx.plan.create({ data });
    await audit(tx, adminId, 'plan.create', 'Plan', plan.id, { fields: Object.keys(data) });
    return plan;
  });
}

export function updatePlan(adminId, id, data) {
  return mutate(adminId, async (tx) => {
    const current = notFound(await tx.plan.findUnique({ where: { id } }), 'Тариф');
    if (data.productId && data.productId !== current.productId) {
      notFound(await tx.product.findUnique({ where: { id: data.productId }, select: { id: true } }), 'Продукт');
      const orders = await tx.order.count({ where: { planId: id } });
      const subscriptions = await tx.subscription.count({ where: { planId: id } });
      if (orders || subscriptions) throw new AppError(409, 'Используемый тариф нельзя перенести в другой продукт; создайте новый тариф');
    }
    const plan = await tx.plan.update({ where: { id }, data });
    await audit(tx, adminId, 'plan.update', 'Plan', id, { fields: Object.keys(data) });
    return plan;
  });
}

export const listPromos = (query) => paged(prisma.promoCode, query);

function checkPromoLimits(promo) {
  if (promo.type === 'percent' && Number(promo.value) > 100) throw new AppError(400, 'Процент скидки не может превышать 100');
  if (promo.maxUses !== null && promo.maxUses !== undefined && promo.maxUses < (promo.usedCount || 0) + (promo.reservedCount || 0)) {
    throw new AppError(409, 'Лимит не может быть меньше суммы использований и резервов ожидающих оплаты заказов');
  }
}

export function createPromo(adminId, _id, data) {
  return mutate(adminId, async (tx) => {
    checkPromoLimits(data);
    const promo = await tx.promoCode.create({ data: { ...data, ...(data.expiresAt ? { expiresAt: new Date(data.expiresAt) } : {}) } });
    await audit(tx, adminId, 'promocode.create', 'PromoCode', promo.id, { fields: Object.keys(data) });
    return promo;
  });
}

export function updatePromo(adminId, id, data) {
  return mutate(adminId, async (tx) => {
    const current = notFound(await tx.promoCode.findUnique({ where: { id } }), 'Промокод');
    checkPromoLimits({ ...current, ...data });
    // Order retries compare the submitted code to this record. Keep codes stable
    // once referenced, so editing an offer cannot change an existing request's identity.
    if (data.code && data.code !== current.code && await tx.order.count({ where: { promoCodeId: id } })) {
      throw new AppError(409, 'Код уже связан с заказами: создайте новый промокод для другого названия');
    }
    const update = { ...data };
    if (data.expiresAt) update.expiresAt = new Date(data.expiresAt);
    const promo = await tx.promoCode.update({ where: { id }, data: update });
    await audit(tx, adminId, 'promocode.update', 'PromoCode', id, { fields: Object.keys(data) });
    return promo;
  });
}

export function listOrders(query) {
  const { status, userId, productId } = query;
  return paged(prisma.order, query, { where: { ...(status && { status }), ...(userId && { userId }), ...(productId && { productId }) }, include: { ...saleInclude, payment: true } });
}

export async function listSubscriptions(query) {
  const { status, userId, productId } = query;
  const now = new Date();
  // Expiry is effective at read time, even when the expiry maintenance job has not run.
  const statusFilter = status === 'active' ? { status: 'active', expiresAt: { gt: now } }
    : status === 'expired' ? { OR: [{ status: 'expired' }, { status: 'active', expiresAt: { lte: now } }] }
      : status ? { status } : {};
  const result = await paged(prisma.subscription, query, { where: { ...statusFilter, ...(userId && { userId }), ...(productId && { productId }) }, include: saleInclude });
  result.items = result.items.map((subscription) => ({
    ...subscription,
    status: subscription.status === 'active' && subscription.expiresAt <= now ? 'expired' : subscription.status,
  }));
  return result;
}

export function createSubscription(adminId, _id, data) {
  return mutate(adminId, async (tx) => {
    const now = new Date();
    const expiresAt = new Date(data.expiresAt);
    if (expiresAt <= now) throw new AppError(400, 'Дата окончания подписки должна быть в будущем');
    const user = notFound(await tx.user.findUnique({ where: { id: data.userId }, select: { id: true, isBlocked: true } }), 'Пользователь');
    if (user.isBlocked) throw new AppError(409, 'Нельзя выдать подписку заблокированному пользователю');
    notFound(await tx.product.findUnique({ where: { id: data.productId }, select: { id: true } }), 'Продукт');
    const plan = notFound(await tx.plan.findUnique({ where: { id: data.planId }, select: { productId: true } }), 'Тариф');
    if (plan.productId !== data.productId) throw new AppError(400, 'Тариф не принадлежит выбранному продукту');
    const where = { userId_productId: { userId: data.userId, productId: data.productId } };
    const existing = await tx.subscription.findUnique({ where });
    const active = existing?.status === 'active' && existing.expiresAt > now;
    if (active && expiresAt <= existing.expiresAt) throw new AppError(409, 'У пользователя уже есть активная подписка: выберите более позднюю дату или отредактируйте её');
    const subscription = await tx.subscription.upsert({
      where,
      create: { userId: data.userId, productId: data.productId, planId: data.planId, startsAt: now, expiresAt, status: 'active' },
      update: { planId: data.planId, startsAt: active ? existing.startsAt : now, expiresAt, status: 'active' },
      include: saleInclude,
    });
    await audit(tx, adminId, existing ? 'subscription.manual_extend' : 'subscription.manual_create', 'Subscription', subscription.id, { userId: data.userId, productId: data.productId, expiresAt: expiresAt.toISOString() });
    return subscription;
  });
}

export function updateSubscription(adminId, id, data) {
  return mutate(adminId, async (tx) => {
    const current = notFound(await tx.subscription.findUnique({ where: { id } }), 'Подписка');
    const now = new Date();
    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : current.expiresAt;
    const status = data.status || (current.status === 'cancelled' ? 'cancelled' : expiresAt > now ? 'active' : 'expired');
    if (status === 'active' && expiresAt <= now) throw new AppError(400, 'Для активной подписки укажите будущую дату окончания');
    if (status === 'expired' && expiresAt > now) throw new AppError(400, 'Подписку с будущей датой окончания можно отменить или изменить дату');
    const startsAt = status === 'active' && current.status !== 'active' ? now : current.startsAt;
    if (expiresAt < startsAt) throw new AppError(400, 'Дата окончания не может быть раньше даты начала подписки');
    const subscription = await tx.subscription.update({ where: { id }, data: { expiresAt, status, startsAt }, include: saleInclude });
    await audit(tx, adminId, status === 'cancelled' ? 'subscription.cancel' : 'subscription.update', 'Subscription', id, { fields: Object.keys(data), status, expiresAt: expiresAt.toISOString() });
    return subscription;
  });
}

export const listPayments = (query) => paged(prisma.payment, query, {
  where: query.status ? { status: query.status } : {},
  include: { order: { select: { id: true, user: { select: publicUserSelect }, status: true } } },
});
export const listLogs = (query) => paged(prisma.adminLog, query, { include: { admin: { select: actorSelect } } });
