import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
const eventSchema = z.object({eventId:z.string().uuid(),orderId:z.string().uuid(),paymentId:z.string().min(1).max(100),status:z.literal('succeeded'),amount:z.string().regex(/^\d+\.\d{2}$/),currency:z.literal('RUB')}).strict();
export function verifySignature(raw, header, secret, now = Date.now()) {
  if (!Buffer.isBuffer(raw) || typeof header !== 'string') throw new AppError(401,'Некорректная подпись платежа');
  const match = /^(\d{10})\.([a-f0-9]{64})$/.exec(header);
  if (!match || Math.abs(now / 1000 - Number(match[1])) > 300) throw new AppError(401,'Подпись отсутствует или устарела');
  const expected = createHmac('sha256', secret).update(match[1] + '.').update(raw).digest();
  const actual = Buffer.from(match[2],'hex');
  if (!timingSafeEqual(actual,expected)) throw new AppError(401,'Некорректная подпись платежа');
}
// Provider boundary. A real adapter must perform server-to-server requests using
// provider idempotency keys and verify its own webhook format on the raw bytes.
class SandboxProvider {
  name = 'sandbox';
  async createPayment({orderId}) {
    return {provider:this.name,providerPaymentId:`sandbox_${orderId}`,checkoutUrl:null};
  }
  async checkPayment(payment) {
    // Sandbox ledger is local. A production adapter must query the provider API.
    return {id:payment.id,orderId:payment.orderId,provider:payment.provider,status:payment.status,amount:payment.amount,currency:payment.currency,checkoutUrl:payment.checkoutUrl};
  }
  handleWebhook(raw, signature) {
    verifySignature(raw,signature,env.PAYMENT_WEBHOOK_SECRET);
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { throw new AppError(400,'Некорректный JSON webhook'); }
    return eventSchema.parse(body);
  }
}
export const paymentProvider = new SandboxProvider();
export function signSandboxEvent(event, secret, timestamp = Math.floor(Date.now()/1000)) {
  const raw = JSON.stringify({eventId:randomUUID(),...event});
  return {raw,signature:`${timestamp}.${createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex')}`};
}
