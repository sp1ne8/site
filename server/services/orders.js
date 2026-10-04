import { prisma } from '../config/db.js';
import { serializable } from '../utils/transaction.js';
import { AppError } from '../utils/errors.js';
import { calculatePrice } from '../utils/money.js';
import { validPromo } from './promocodes.js';
import { paymentProvider } from './payment-provider.js';
export const orderInclude = {product:true,plan:true,payment:true};
async function releaseReservation(tx, order) {
  if (order.promoCodeId) await tx.promoCode.update({where:{id:order.promoCodeId},data:{reservedCount:{decrement:1}}});
}
export async function cancelPending(tx, order) {
  if (order.status !== 'pending') throw new AppError(409,'Можно отменить только неоплаченный заказ');
  await tx.order.update({where:{id:order.id},data:{status:'cancelled'}});
  if (order.paymentId) await tx.payment.update({where:{id:order.paymentId},data:{status:'cancelled'}});
  await releaseReservation(tx,order);
}
export async function expireOrders() {
  // Bound each batch; repeated runs drain any backlog without a long transaction.
  const expired = await prisma.order.findMany({where:{status:'pending',expiresAt:{lte:new Date()}},select:{id:true},take:100});
  for (const {id} of expired) await serializable(async tx => {
    const order = await tx.order.findUnique({where:{id}});
    if (order?.status === 'pending' && order.expiresAt <= new Date()) await cancelPending(tx,order);
  });
  return expired.length;
}
export async function createOrder(userId,input) {
  await expireOrders();
  return serializable(async tx => {
    const existing = await tx.order.findUnique({where:{idempotencyKey:input.idempotencyKey},include:{...orderInclude,promoCode:true}});
    if (existing) {
      if (existing.userId !== userId || existing.productId !== input.productId || existing.planId !== input.planId || (existing.promoCode?.code || '') !== (input.promoCode || '')) throw new AppError(409,'Ключ запроса уже использован для другого заказа');
      const {promoCode,...result} = existing; return result;
    }
    const user = await tx.user.findUnique({where:{id:userId}});
    if (!user || user.isBlocked) throw new AppError(403,'Доступ запрещён');
    if (await tx.order.count({where:{userId,status:'pending'}}) >= 10) throw new AppError(429,'Слишком много неоплаченных заказов. Отмените предыдущие');
    const plan = await tx.plan.findFirst({where:{id:input.planId,productId:input.productId,isActive:true,product:{isActive:true}}});
    if (!plan) throw new AppError(404,'Продукт или тариф недоступен');
    const promo = await validPromo(tx,input.promoCode);
    if (promo) await tx.promoCode.update({where:{id:promo.id},data:{reservedCount:{increment:1}}});
    const order = await tx.order.create({data:{userId,productId:plan.productId,planId:plan.id,promoCodeId:promo?.id,...calculatePrice(plan.price,promo),durationDays:plan.durationDays,idempotencyKey:input.idempotencyKey,expiresAt:new Date(Date.now()+30*60*1000)}});
    // Sandbox createPayment has no network side effects. For a remote adapter,
    // move creation to an outbox worker and use order.id as the provider key.
    const created = await paymentProvider.createPayment({orderId:order.id,amount:order.finalPrice,currency:order.currency});
    const payment = await tx.payment.create({data:{orderId:order.id,...created,amount:order.finalPrice,currency:order.currency}});
    return tx.order.update({where:{id:order.id},data:{paymentId:payment.id},include:orderInclude});
  });
}
export async function listOrders(userId,{page,pageSize}) {
  const where = {userId};
  const [items,total] = await prisma.$transaction([prisma.order.findMany({where,include:orderInclude,orderBy:{createdAt:'desc'},skip:(page-1)*pageSize,take:pageSize}),prisma.order.count({where})]);
  return {items,total,page,pageSize};
}
export async function getOrder(userId,id) {
  const order = await prisma.order.findFirst({where:{id,userId},include:orderInclude});
  if (!order) throw new AppError(404,'Заказ не найден');
  return order;
}
export async function cancelOrder(userId,id) {
  await serializable(async tx => {
    const order = await tx.order.findFirst({where:{id,userId}});
    if (!order) throw new AppError(404,'Заказ не найден');
    await cancelPending(tx,order);
  });
  return getOrder(userId,id);
}
