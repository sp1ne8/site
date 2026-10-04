import { env } from '../config/env.js';
import { prisma } from '../config/db.js';
import bcrypt from 'bcrypt';
if (env.NODE_ENV === 'production') throw new Error('Demo seed disabled in production');
if (!env.SEED_ADMIN_PASSWORD || env.SEED_ADMIN_PASSWORD.startsWith('replace-')) throw new Error('Set SEED_ADMIN_PASSWORD (12+ characters) in server/.env');
try {
  await prisma.user.upsert({where:{email:env.SEED_ADMIN_EMAIL.toLowerCase()},update:{},create:{username:'admin',email:env.SEED_ADMIN_EMAIL.toLowerCase(),passwordHash:await bcrypt.hash(env.SEED_ADMIN_PASSWORD,12),role:'admin'}});
  for (const [slug,name,shortDescription,base] of [
    ['digital-library','Цифровая библиотека','Материалы и шаблоны для ваших проектов.',100],
    ['learning-space','Учебное пространство','Подборка практических уроков и руководств.',150],
    ['toolbox','Набор инструментов','Коллекция полезных цифровых ресурсов.',200]
  ]) {
    const product = await prisma.product.upsert({where:{slug},update:{},create:{slug,name,shortDescription,description:`${shortDescription}\nДемонстрационный продукт. Содержимое и способ его выдачи можно подключить к проверке активной подписки.`}});
    for (const durationDays of [1,7,30,90]) {
      const name = `${durationDays} дн.`;
      if (!await prisma.plan.findFirst({where:{productId:product.id,name}})) await prisma.plan.create({data:{productId:product.id,name,durationDays,price:String(base * ({1:1,7:4,30:10,90:25}[durationDays]))}});
    }
  }
  for (const data of [{code:'WELCOME10',type:'percent',value:'10',maxUses:100},{code:'SAVE100',type:'fixed',value:'100',maxUses:50}]) await prisma.promoCode.upsert({where:{code:data.code},update:{},create:{...data,expiresAt:new Date(Date.now()+365*86400000)}});
  console.log('Seed complete: admin, 3 products, 12 plans, 2 promo codes. Existing records were preserved.');
} finally { await prisma.$disconnect(); }
