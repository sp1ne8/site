import { prisma } from '../config/db.js';
import { serializable } from '../utils/transaction.js';
import { AppError } from '../utils/errors.js';
import { toCents } from '../utils/money.js';
import { paymentProvider } from './payment-provider.js';
export const createPayment = input => paymentProvider.createPayment(input);
export async function checkPayment(userId,id) {
  const payment = await prisma.payment.findFirst({where:{id,order:{userId}}});
  if (!payment) throw new AppError(404,'Платёж не найден');
  return paymentProvider.checkPayment(payment);
}
export async function handleWebhook(raw,signature) {
  const event = paymentProvider.handleWebhook(raw,signature);
  return serializable(async tx => {
    const payment = await tx.payment.findUnique({where:{providerPaymentId:event.paymentId}});
    if (!payment || payment.provider !== paymentProvider.name || payment.orderId !== event.orderId) throw new AppError(400,'Платёж не соответствует заказу');
    const order = await tx.order.findUnique({where:{id:event.orderId}});
    if (!order || order.paymentId !== payment.id || toCents(event.amount) !== toCents(order.finalPrice) || toCents(event.amount) !== toCents(payment.amount) || event.currency !== order.currency || event.currency !== payment.currency) throw new AppError(400,'Сумма или валюта платежа не совпадает');
    if (order.status === 'paid' && payment.status === 'succeeded') return {received:true,alreadyProcessed:true};
    if (order.status !== 'pending' || payment.status !== 'pending' || order.expiresAt <= new Date()) throw new AppError(409,'Заказ отменён или срок оплаты истёк');
    const now = new Date();
    const previous = await tx.subscription.findUnique({where:{userId_productId:{userId:order.userId,productId:order.productId}}});
    const extend = previous?.status === 'active' && previous.expiresAt > now;
    const expiresAt = new Date((extend ? previous.expiresAt : now).getTime() + order.durationDays*86400000);
    const data = {planId:order.planId,startsAt:extend ? previous.startsAt : now,expiresAt,status:'active'};
    await tx.subscription.upsert({where:{userId_productId:{userId:order.userId,productId:order.productId}},create:{userId:order.userId,productId:order.productId,...data},update:data});
    await tx.payment.update({where:{id:payment.id},data:{status:'succeeded'}});
    await tx.order.update({where:{id:order.id},data:{status:'paid'}});
    if (order.promoCodeId) await tx.promoCode.update({where:{id:order.promoCodeId},data:{reservedCount:{decrement:1},usedCount:{increment:1}}});
    return {received:true,alreadyProcessed:false};
  });
}
