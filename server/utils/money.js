import { AppError } from './errors.js';
export function toCents(value) {
  const s = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new AppError(400, 'Некорректная денежная сумма');
  const [whole, fraction = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 999999999999) throw new AppError(400, 'Слишком большая сумма');
  return cents;
}
export const fromCents = cents => (cents / 100).toFixed(2);
export function calculatePrice(price, promo) {
  const original = toCents(price);
  const raw = !promo ? 0 : promo.type === 'fixed' ? toCents(promo.value) : Number((BigInt(original) * BigInt(toCents(promo.value)) + 5000n) / 10000n);
  const discount = Math.min(original, raw);
  return { originalPrice: fromCents(original), discount: fromCents(discount), finalPrice: fromCents(original - discount) };
}
