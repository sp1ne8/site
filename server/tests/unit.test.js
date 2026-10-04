import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { calculatePrice, toCents } from '../utils/money.js';
// No database or .env needed for the unit suite.
process.env.NODE_ENV='test';
process.env.DATABASE_URL ||= 'postgresql://unused:unused@127.0.0.1:5432/unused_test';
process.env.PAYMENT_WEBHOOK_SECRET ||= 'unit-test-secret-that-is-at-least-32-characters';
const { signSandboxEvent,verifySignature }=await import('../services/payment-provider.js');
const secret='independent-unit-test-secret-32-characters';
test('money is parsed exactly in cents',()=>{
 assert.equal(toCents('12.01'),1201);
 for(const value of ['-1','1.234','NaN','1e3','10000000000.00']) assert.throws(()=>toCents(value));
});
test('percent discount is rounded half up',()=>assert.deepEqual(calculatePrice('0.05',{type:'percent',value:'10'}),{originalPrice:'0.05',discount:'0.01',finalPrice:'0.04'}));
test('fixed discount never makes order negative',()=>assert.equal(calculatePrice('10',{type:'fixed',value:'100'}).finalPrice,'0.00'));
test('max database amounts retain correct cent precision',()=>{
 const input=999999999999n,percent=9999n;
 const expected=Number((input*percent+5000n)/10000n)/100;
 assert.equal(calculatePrice('9999999999.99',{type:'percent',value:'99.99'}).discount,expected.toFixed(2));
});
test('webhook signature binds all raw bytes',()=>{
 const {raw,signature}=signSandboxEvent({orderId:randomUUID(),paymentId:'sandbox_test',amount:'10.00',currency:'RUB',status:'succeeded'},secret);
 assert.doesNotThrow(()=>verifySignature(Buffer.from(raw),signature,secret));
 assert.throws(()=>verifySignature(Buffer.from(raw+' '),signature,secret));
 assert.throws(()=>verifySignature(Buffer.from(raw),signature,secret+'different'));
});
test('stale and malformed signatures are rejected',()=>{
 const {raw,signature}=signSandboxEvent({},secret,Math.floor(Date.now()/1000)-301);
 assert.throws(()=>verifySignature(Buffer.from(raw),signature,secret));
 for(const header of [undefined,'abc','1234567890.00']) assert.throws(()=>verifySignature(Buffer.from(raw),header,secret));
});
