import { prisma } from '../config/db.js';
import { AppError } from '../utils/errors.js';
import { calculatePrice } from '../utils/money.js';
export async function validPromo(db, code, now = new Date()) {
  if (!code) return null;
  const promo = await db.promoCode.findUnique({where:{code:code.trim().toUpperCase()}});
  if (!promo || !promo.isActive || (promo.expiresAt && promo.expiresAt <= now) || (promo.maxUses !== null && promo.usedCount + promo.reservedCount >= promo.maxUses)) {
    throw new AppError(400,'Промокод недоступен, истёк или исчерпан');
  }
  return promo;
}
export async function checkPromo({planId,code}) {
  const plan = await prisma.plan.findFirst({where:{id:planId,isActive:true,product:{isActive:true}}});
  if (!plan) throw new AppError(404,'Тариф не найден');
  const promo = await validPromo(prisma,code);
  return {...calculatePrice(plan.price,promo),code:promo.code};
}
