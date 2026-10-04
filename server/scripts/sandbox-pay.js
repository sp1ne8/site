import { env } from '../config/env.js';
import { prisma } from '../config/db.js';
import { signSandboxEvent } from '../services/payment-provider.js';
if (env.NODE_ENV === 'production') throw new Error('Sandbox CLI is unavailable in production');
const orderId = process.argv[2];
if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) throw new Error('Usage: npm run sandbox:pay -- <order UUID>');
try {
  const order = await prisma.order.findUnique({where:{id:orderId},include:{payment:true}});
  if (!order?.payment) throw new Error('Order/payment not found');
  const {raw,signature} = signSandboxEvent({orderId:order.id,paymentId:order.payment.providerPaymentId,status:'succeeded',amount:order.finalPrice.toFixed(2),currency:order.currency},env.PAYMENT_WEBHOOK_SECRET);
  const response = await fetch(`${env.SERVER_URL}/api/payments/webhook`,{method:'POST',headers:{'Content-Type':'application/json','x-payment-signature':signature},body:raw});
  console.log(`Webhook HTTP ${response.status}:`,await response.json());
  if (!response.ok) process.exitCode=1;
} finally {await prisma.$disconnect();}
