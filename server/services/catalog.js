import { prisma } from '../config/db.js';
import { AppError } from '../utils/errors.js';
export async function listProducts({page,pageSize}) {
  const where = {isActive:true};
  const [items,total] = await prisma.$transaction([
    prisma.product.findMany({where, include:{plans:{where:{isActive:true},orderBy:{durationDays:'asc'}}}, orderBy:{createdAt:'asc'},skip:(page-1)*pageSize,take:pageSize}),
    prisma.product.count({where})
  ]);
  return {items,total,page,pageSize};
}
export async function getProduct(slug) {
  const product = await prisma.product.findFirst({where:{slug,isActive:true},include:{plans:{where:{isActive:true},orderBy:{durationDays:'asc'}}}});
  if (!product) throw new AppError(404,'Продукт не найден');
  return product;
}
export const listPlans = productId => prisma.plan.findMany({where:{...(productId ? {productId} : {}),isActive:true,product:{isActive:true}},include:{product:true},orderBy:{durationDays:'asc'}});
export async function listSubscriptions(userId) {
  await prisma.subscription.updateMany({where:{userId,status:'active',expiresAt:{lte:new Date()}},data:{status:'expired'}});
  return prisma.subscription.findMany({where:{userId},include:{product:true,plan:true},orderBy:{expiresAt:'desc'}});
}
// Use this guard from future download/content endpoints; never trust the stored status alone.
export async function requireProductAccess(userId, productId) {
  const sub = await prisma.subscription.findFirst({where:{userId,productId,status:'active',expiresAt:{gt:new Date()},user:{isBlocked:false},product:{isActive:true}}});
  if (!sub) throw new AppError(403,'Для этого продукта требуется активная подписка');
  return sub;
}
