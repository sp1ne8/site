import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import request from 'supertest';
import bcrypt from 'bcrypt';

// Refuse to connect to a normal development/production database. Set DATABASE_URL
// explicitly to a migrated PostgreSQL database whose name ends in `_test`.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const testDatabase = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (!testDatabase || !decodeURIComponent(testDatabase.pathname).replace(/^\//, '').endsWith('_test')) {
  throw new Error('Integration tests require DATABASE_URL pointing to a dedicated database ending in _test. No fixtures were created.');
}
process.env.NODE_ENV = 'test';
process.env.SMTP_HOST = ''; // Never send real email from an integration test.
process.env.SMTP_USER = '';
process.env.PAYMENT_WEBHOOK_SECRET ||= 'integration-only-webhook-secret-at-least-32-characters';
const { app } = await import('../app.js');
const { prisma } = await import('../config/db.js');
const { env } = await import('../config/env.js');
const { signSandboxEvent } = await import('../services/payment-provider.js');
const { publicBundle } = await import('../services/legal.js');
const legal = await publicBundle('RU');
const documentId = kind => legal.documents.find(item => item.kind === kind).id;
const registrationProof = { jurisdiction: 'RU', policyAcknowledged: true, termsAccepted: true, policyDocumentId: documentId('personal-data-policy'), termsDocumentId: documentId('terms') };
const orderProof = { offerAccepted: true, refundAcknowledged: true, offerDocumentId: documentId('offer'), refundDocumentId: documentId('refund-policy') };

const DAY = 86_400_000;
const prefix = `it_${randomUUID().slice(0, 8)}`;
const password = 'IntegrationPassword!42';
const userIds = new Set();
const productIds = new Set();
const promoIds = new Set();
const mailFiles = new Set();
const outbox = fileURLToPath(new URL('../storage/mail-outbox/', import.meta.url));

function api(method, path, body, cookie) {
  if (path === '/api/auth/register' && body) body = { ...registrationProof, ...body };
  const call = request(app)[method](path)
    .set('Origin', new URL(env.CLIENT_URL).origin)
    .set('X-Requested-With', 'XMLHttpRequest');
  if (cookie) call.set('Cookie', cookie);
  if (body !== undefined) call.send(body);
  return call;
}

function succeeded(response, status = 200) {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(response.body.success, true);
  assert.ok(Object.hasOwn(response.body, 'data'));
  return response.body.data;
}

function failed(response, status) {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(response.body.success, false);
  assert.equal(typeof response.body.message, 'string');
  assert.equal(Object.hasOwn(response.body, 'data'), false);
}

function cookieFrom(response) {
  const header = response.headers['set-cookie']?.find((value) => value.startsWith(`${env.COOKIE_NAME}=`));
  assert.ok(header, 'Authentication must set a session cookie');
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Lax/i);
  return header.split(';')[0];
}

async function fixtureUser(suffix, role = 'user') {
  const user = await prisma.user.create({ data: {
    username: `${prefix}_${suffix}`, email: `${prefix}_${suffix}@example.test`,
    passwordHash: await bcrypt.hash(password, 4), role, jurisdiction: 'RU',
  } });
  userIds.add(user.id);
  return user;
}

async function fixtureProduct(suffix, options = {}) {
  const product = await prisma.product.create({ data: {
    name: `Integration ${suffix}`, slug: `${prefix.replaceAll('_', '-')}-${suffix}`,
    shortDescription: 'Isolated test fixture', description: 'Removed by this test run',
    isActive: options.isActive ?? true,
    plans: { create: { name: '7 days', durationDays: 7, price: '100.00', isActive: true } },
  }, include: { plans: true } });
  productIds.add(product.id);
  return { ...product, plan: product.plans[0] };
}

async function fixturePromo(suffix, options = {}) {
  const promo = await prisma.promoCode.create({ data: {
    code: `${prefix}_${suffix}`.toUpperCase(), type: 'percent', value: '25.00', ...options,
  } });
  promoIds.add(promo.id);
  return promo;
}

const orderInput = (product, extra = {}) => ({
  productId: product.id, planId: product.plan.id, idempotencyKey: randomUUID(), ...orderProof, ...extra,
});

async function createOrder(cookie, product, extra = {}) {
  return succeeded(await api('post', '/api/orders', orderInput(product, extra), cookie), 201);
}

function webhook(order, overrides = {}, options = {}) {
  const signed = signSandboxEvent({
    orderId: order.id, paymentId: order.payment.providerPaymentId,
    status: 'succeeded', amount: Number(order.finalPrice).toFixed(2), currency: 'RUB', ...overrides,
  }, options.secret || env.PAYMENT_WEBHOOK_SECRET, options.timestamp);
  return request(app).post('/api/payments/webhook')
    .set('Content-Type', 'application/json').set('X-Payment-Signature', signed.signature).send(signed.raw);
}

async function subscription(userId, productId) {
  return prisma.subscription.findUnique({ where: { userId_productId: { userId, productId } } });
}

async function resetTokenFor(email) {
  const files = await readdir(outbox);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const fullPath = `${outbox}/${file}`;
    const mail = JSON.parse(await readFile(fullPath, 'utf8'));
    if (mail.to !== email) continue;
    mailFiles.add(fullPath);
    const match = mail.text.match(/https?:\/\/\S+/);
    assert.ok(match, 'Development email must contain the reset link');
    return new URL(match[0]).searchParams.get('token');
  }
  assert.fail('A reset email for the fixture account was not written');
}

async function cleanup() {
  // Only IDs created by this process are eligible for deletion. Never truncate
  // tables, drop schemas, or delete another test/developer's data.
  const ids = [...userIds];
  try {
    if (ids.length) {
      await prisma.adminLog.deleteMany({ where: { adminId: { in: ids } } });
      await prisma.order.updateMany({ where: { userId: { in: ids } }, data: { paymentId: null } });
      await prisma.payment.deleteMany({ where: { order: { userId: { in: ids } } } });
      await prisma.order.deleteMany({ where: { userId: { in: ids } } });
      await prisma.subscription.deleteMany({ where: { userId: { in: ids } } });
      await prisma.session.deleteMany({ where: { userId: { in: ids } } });
      await prisma.passwordReset.deleteMany({ where: { userId: { in: ids } } });
      await prisma.retentionHold.deleteMany({ where: { userId: { in: ids } } });
      await prisma.dataRequest.deleteMany({ where: { userId: { in: ids } } });
      await prisma.consentEvent.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.plan.deleteMany({ where: { productId: { in: [...productIds] } } });
    await prisma.product.deleteMany({ where: { id: { in: [...productIds] } } });
    await prisma.promoCode.deleteMany({ where: { id: { in: [...promoIds] } } });
  } finally {
    for (const file of mailFiles) await unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await prisma.$disconnect();
  }
}

test('PostgreSQL API integration: authentication, authorization and transactional commerce', { timeout: 120_000 }, async (t) => {
  t.after(cleanup);
  const other = await fixtureUser('other');
  const admin = await fixtureUser('admin', 'admin');
  const blocked = await fixtureUser('blocked');
  const primary = await fixtureProduct('primary');
  const fresh = await fixtureProduct('concurrent');
  const discounted = await fixtureProduct('discounted');
  const snapshot = await fixtureProduct('snapshot');
  const cancelled = await fixtureProduct('cancelled');
  const expired = await fixtureProduct('expired');
  const inactive = await fixtureProduct('inactive', { isActive: false });
  const limited = await fixturePromo('limited', { maxUses: 1 });
  const expiryPromo = await fixturePromo('expiry', { maxUses: 1 });
  const disabledPromo = await fixturePromo('disabled', { isActive: false });
  const expiredPromo = await fixturePromo('old', { expiresAt: new Date(Date.now() - DAY) });
  const exhaustedPromo = await fixturePromo('exhausted', { maxUses: 1, usedCount: 1 });
  const otherCookie = cookieFrom(await api('post', '/api/auth/login', { email: other.email, password }));
  const adminCookie = cookieFrom(await api('post', '/api/auth/login', { email: admin.email, password }));
  const blockedCookie = cookieFrom(await api('post', '/api/auth/login', { email: blocked.email, password }));
  let user, cookie, mainOrder;

  await t.test('registration normalizes identity, hashes password and returns only safe fields', async () => {
    const response = await api('post', '/api/auth/register', {
      username: `${prefix}_buyer`.toUpperCase(), email: `${prefix}_buyer@EXAMPLE.TEST`, password, confirmPassword: password,
    });
    user = succeeded(response, 201);
    userIds.add(user.id);
    cookie = cookieFrom(response);
    assert.equal(user.username, `${prefix}_buyer`);
    assert.equal(user.email, `${prefix}_buyer@example.test`);
    assert.equal(user.role, 'user');
    assert.equal(Object.hasOwn(user, 'passwordHash'), false);
    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    assert.notEqual(stored.passwordHash, password);
    assert.equal(await bcrypt.compare(password, stored.passwordHash), true);
    const token = cookie.split('=')[1];
    const session = await prisma.session.findFirst({ where: { userId: user.id } });
    assert.equal(session.tokenHash, createHash('sha256').update(token).digest('hex'));
    assert.notEqual(session.tokenHash, token);
    assert.equal(succeeded(await api('get', '/api/auth/me', undefined, cookie)).id, user.id);
  });

  await t.test('duplicate identities, role injection, mismatched and oversized passwords are rejected', async () => {
    failed(await api('post', '/api/auth/register', { username: user.username, email: user.email, password, confirmPassword: password }), 409);
    failed(await api('post', '/api/auth/register', { username: `${prefix}_bad`, email: `${prefix}_bad@example.test`, password, confirmPassword: password, role: 'admin' }), 400);
    failed(await api('post', '/api/auth/register', { username: `${prefix}_bad`, email: `${prefix}_bad@example.test`, password, confirmPassword: 'DifferentPassword42' }), 400);
    failed(await api('post', '/api/auth/register', { username: `${prefix}_bad`, email: `${prefix}_bad@example.test`, password: 'я'.repeat(37), confirmPassword: 'я'.repeat(37) }), 400);
    failed(await api('post', '/api/auth/login', { email: user.email, password: 'IncorrectPassword42' }), 401);
  });

  await t.test('CSRF header and allowed origins are required for mutations', async () => {
    failed(await request(app).post('/api/auth/logout').set('Cookie', cookie).send({}), 403);
    failed(await request(app).post('/api/auth/logout').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest').set('Origin', 'https://attacker.example').send({}), 403);
    assert.equal(succeeded(await api('get', '/api/auth/me', undefined, cookie)).id, user.id);
  });

  await t.test('protected resources reject unknown sessions and ordinary users cannot access admin API', async () => {
    failed(await api('get', '/api/orders'), 401);
    failed(await api('get', '/api/auth/me', undefined, `${env.COOKIE_NAME}=${'a'.repeat(64)}`), 401);
    failed(await api('get', '/api/admin/dashboard', undefined, cookie), 403);
    failed(await api('patch', `/api/admin/users/${user.id}`, { role: 'admin' }, cookie), 403);
  });

  await t.test('strict query, route ID and checkout input validation prevents price/status injection', async () => {
    failed(await api('get', '/api/products?unexpected=1'), 400);
    failed(await api('get', '/api/orders/not-a-uuid', undefined, cookie), 400);
    failed(await api('post', '/api/orders', orderInput(primary, { finalPrice: '0.01', status: 'paid' }), cookie), 400);
    failed(await api('post', '/api/orders', orderInput(primary, { planId: inactive.plan.id }), cookie), 404);
    failed(await api('post', '/api/orders', orderInput(inactive), cookie), 404);
  });

  await t.test('checkout snapshots backend price and stays pending before trusted confirmation', async () => {
    mainOrder = await createOrder(cookie, primary);
    assert.equal(Number(mainOrder.finalPrice), 100);
    assert.equal(mainOrder.durationDays, 7);
    assert.equal(mainOrder.status, 'pending');
    assert.equal(mainOrder.payment.status, 'pending');
    assert.equal(await subscription(user.id, primary.id), null);
    failed(await api('post', `/api/payments/${mainOrder.payment.id}/success`, {}, cookie), 404);
  });

  await t.test('idempotency returns the same order and refuses another owner or different cart', async () => {
    const input = orderInput(primary, { idempotencyKey: mainOrder.idempotencyKey });
    const repeated = succeeded(await api('post', '/api/orders', input, cookie), 201);
    assert.equal(repeated.id, mainOrder.id);
    assert.equal(await prisma.payment.count({ where: { orderId: mainOrder.id } }), 1);
    failed(await api('post', '/api/orders', input, otherCookie), 409);
    failed(await api('post', '/api/orders', { ...input, productId: fresh.id, planId: fresh.plan.id }, cookie), 409);
  });

  await t.test('orders and payments enforce ownership on read, list and cancel', async () => {
    failed(await api('get', `/api/orders/${mainOrder.id}`, undefined, otherCookie), 404);
    failed(await api('post', `/api/orders/${mainOrder.id}/cancel`, {}, otherCookie), 404);
    failed(await api('get', `/api/payments/${mainOrder.payment.id}`, undefined, otherCookie), 404);
    const orders = succeeded(await api('get', '/api/orders', undefined, otherCookie));
    assert.equal(orders.items.some((order) => order.id === mainOrder.id), false);
    assert.equal(succeeded(await api('get', `/api/payments/${mainOrder.payment.id}`, undefined, cookie)).status, 'pending');
  });

  await t.test('forged and stale webhook signatures cannot activate a subscription', async () => {
    failed(await webhook(mainOrder, {}, { secret: 'wrong-secret' }), 401);
    failed(await webhook(mainOrder, {}, { timestamp: Math.floor(Date.now() / 1000) - 601 }), 401);
    assert.equal(await subscription(user.id, primary.id), null);
  });

  await t.test('signed callbacks still reject amount, order and provider status mismatches', async () => {
    failed(await webhook(mainOrder, { amount: '0.01' }), 400);
    failed(await webhook(mainOrder, { orderId: randomUUID() }), 400);
    failed(await webhook(mainOrder, { status: 'pending' }), 400);
    failed(await webhook(mainOrder, { currency: 'USD' }), 400);
    assert.equal((await prisma.order.findUnique({ where: { id: mainOrder.id } })).status, 'pending');
  });

  await t.test('concurrent duplicate callbacks grant exactly one term and retries are idempotent', async () => {
    const responses = await Promise.all([webhook(mainOrder), webhook(mainOrder)]);
    const processed = responses.map((response) => succeeded(response).alreadyProcessed).sort();
    assert.deepEqual(processed, [false, true]);
    const active = await subscription(user.id, primary.id);
    assert.equal(active.status, 'active');
    assert.equal(active.expiresAt - active.startsAt, 7 * DAY);
    const expiry = active.expiresAt.getTime();
    assert.equal(succeeded(await webhook(mainOrder)).alreadyProcessed, true);
    assert.equal((await subscription(user.id, primary.id)).expiresAt.getTime(), expiry);
    assert.equal((await prisma.order.findUnique({ where: { id: mainOrder.id } })).status, 'paid');
    assert.equal((await prisma.payment.findUnique({ where: { id: mainOrder.payment.id } })).status, 'succeeded');
  });

  await t.test('two different concurrent payments extend an existing subscription by both terms', async () => {
    const before = await subscription(user.id, primary.id);
    const first = await createOrder(cookie, primary);
    const second = await createOrder(cookie, primary);
    for (const response of await Promise.all([webhook(first), webhook(second)])) succeeded(response);
    const after = await subscription(user.id, primary.id);
    assert.equal(after.id, before.id);
    assert.equal(after.startsAt.getTime(), before.startsAt.getTime());
    assert.equal(after.expiresAt.getTime(), before.expiresAt.getTime() + 14 * DAY);
  });

  await t.test('two initial payments racing to create a subscription produce one row with both terms', async () => {
    const first = await createOrder(cookie, fresh);
    const second = await createOrder(cookie, fresh);
    for (const response of await Promise.all([webhook(first), webhook(second)])) succeeded(response);
    const active = await subscription(user.id, fresh.id);
    assert.equal(await prisma.subscription.count({ where: { userId: user.id, productId: fresh.id } }), 1);
    assert.equal(active.expiresAt - active.startsAt, 14 * DAY);
  });

  await t.test('a price/duration edit after checkout does not alter the paid order snapshot', async () => {
    const order = await createOrder(cookie, snapshot);
    await prisma.plan.update({ where: { id: snapshot.plan.id }, data: { price: '900.00', durationDays: 90 } });
    succeeded(await webhook(order));
    const active = await subscription(user.id, snapshot.id);
    assert.equal(active.expiresAt - active.startsAt, 7 * DAY);
    assert.equal(Number((await prisma.order.findUnique({ where: { id: order.id } })).finalPrice), 100);
  });

  await t.test('disabled, expired and exhausted promo codes cannot be applied', async () => {
    for (const promo of [disabledPromo, expiredPromo, exhaustedPromo]) {
      failed(await api('post', '/api/promocodes/check', { planId: primary.plan.id, code: promo.code }, cookie), 400);
    }
  });

  await t.test('the last promo reservation is exclusive, cancellation releases it and payment consumes it once', async () => {
    const attempts = await Promise.all([
      api('post', '/api/orders', orderInput(discounted, { promoCode: limited.code }), cookie),
      api('post', '/api/orders', orderInput(discounted, { promoCode: limited.code }), otherCookie),
    ]);
    assert.deepEqual(attempts.map((response) => response.status).sort(), [201, 400]);
    const winnerIndex = attempts.findIndex((response) => response.status === 201);
    const winner = succeeded(attempts[winnerIndex], 201);
    const winnerCookie = winnerIndex === 0 ? cookie : otherCookie;
    assert.equal(Number(winner.finalPrice), 75);
    let promo = await prisma.promoCode.findUnique({ where: { id: limited.id } });
    assert.equal(promo.reservedCount, 1);
    assert.equal(promo.usedCount, 0);
    succeeded(await api('post', `/api/orders/${winner.id}/cancel`, {}, winnerCookie));
    assert.equal((await prisma.promoCode.findUnique({ where: { id: limited.id } })).reservedCount, 0);
    const replacement = await createOrder(cookie, discounted, { promoCode: limited.code });
    succeeded(await webhook(replacement));
    succeeded(await webhook(replacement));
    promo = await prisma.promoCode.findUnique({ where: { id: limited.id } });
    assert.equal(promo.reservedCount, 0);
    assert.equal(promo.usedCount, 1);
  });

  await t.test('a cancelled order cannot be activated by a correctly signed callback', async () => {
    const order = await createOrder(cookie, cancelled);
    succeeded(await api('post', `/api/orders/${order.id}/cancel`, {}, cookie));
    failed(await webhook(order), 409);
    assert.equal(await subscription(user.id, cancelled.id), null);
    assert.equal((await prisma.payment.findUnique({ where: { id: order.payment.id } })).status, 'cancelled');
  });

  await t.test('an expired order rejects payment and maintenance releases its promo reservation', async () => {
    const order = await createOrder(cookie, expired, { promoCode: expiryPromo.code });
    await prisma.order.update({ where: { id: order.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    failed(await webhook(order), 409);
    assert.equal(await subscription(user.id, expired.id), null);
    succeeded(await api('post', '/api/promocodes/check', { planId: expired.plan.id, code: expiryPromo.code }, cookie));
    assert.equal((await prisma.promoCode.findUnique({ where: { id: expiryPromo.id } })).reservedCount, 0);
    assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).status, 'cancelled');
  });

  await t.test('paid orders cannot be cancelled by the customer', async () => {
    failed(await api('post', `/api/orders/${mainOrder.id}/cancel`, {}, cookie), 409);
    const list = succeeded(await api('get', '/api/subscriptions', undefined, cookie));
    assert.ok(list.some((item) => item.productId === primary.id && item.status === 'active'));
  });

  await t.test('admin mutations create audit records and safe admin lists never expose hashes', async () => {
    const created = succeeded(await api('post', '/api/admin/products', {
      name: 'Audited fixture', slug: `${prefix.replaceAll('_', '-')}-audit`, description: '', shortDescription: '',
    }, adminCookie), 201);
    productIds.add(created.id);
    succeeded(await api('patch', `/api/admin/products/${created.id}`, { name: 'Audited fixture changed' }, adminCookie));
    succeeded(await api('delete', `/api/admin/products/${created.id}`, {}, adminCookie));
    const logs = await prisma.adminLog.findMany({ where: { adminId: admin.id, entityId: created.id } });
    assert.deepEqual(logs.map((log) => log.action).sort(), ['product.create', 'product.deactivate', 'product.update']);
    const users = succeeded(await api('get', `/api/admin/users?search=${prefix}`, undefined, adminCookie));
    assert.ok(users.items.length >= 4);
    assert.equal(JSON.stringify(users).includes('passwordHash'), false);
    const orders = succeeded(await api('get', `/api/admin/orders?userId=${user.id}&status=paid`, undefined, adminCookie));
    assert.ok(orders.items.length >= 1);
    assert.equal(JSON.stringify(orders).includes('passwordHash'), false);
  });

  await t.test('profile changes require the current password and cannot set privileged fields', async () => {
    failed(await api('patch', '/api/users/me', { username: user.username, email: user.email, currentPassword: 'WrongPassword42' }, cookie), 400);
    failed(await api('patch', '/api/users/me', { username: user.username, email: user.email, currentPassword: password, role: 'admin' }, cookie), 400);
    const changed = succeeded(await api('patch', '/api/users/me', { username: `${prefix}_renamed`, email: user.email, currentPassword: password }, cookie));
    assert.equal(changed.username, `${prefix}_renamed`);
    assert.equal(Object.hasOwn(changed, 'passwordHash'), false);
  });

  await t.test('forgot password is generic; reset is hashed, single-use and revokes the previous session', async () => {
    const unknown = succeeded(await api('post', '/api/auth/forgot-password', { email: `${prefix}_missing@example.test` }));
    const known = succeeded(await api('post', '/api/auth/forgot-password', { email: user.email }));
    assert.deepEqual(known, unknown);
    const token = await resetTokenFor(user.email);
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(known).includes(token), false);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    assert.ok(await prisma.passwordReset.findUnique({ where: { tokenHash } }));
    const newPassword = 'ResetPassword!567';
    succeeded(await api('post', '/api/auth/reset-password', { token, password: newPassword, confirmPassword: newPassword }));
    failed(await api('get', '/api/auth/me', undefined, cookie), 401);
    failed(await api('post', '/api/auth/reset-password', { token, password: newPassword, confirmPassword: newPassword }), 400);
    assert.ok((await prisma.passwordReset.findUnique({ where: { tokenHash } })).usedAt);
    cookie = cookieFrom(await api('post', '/api/auth/login', { email: user.email, password: newPassword }));
  });

  await t.test('changing a password revokes every active session, including the current one', async () => {
    const secondCookie = cookieFrom(await api('post', '/api/auth/login', { email: user.email, password: 'ResetPassword!567' }));
    succeeded(await api('patch', '/api/users/me/password', {
      currentPassword: 'ResetPassword!567', password: 'ChangedPassword!890', confirmPassword: 'ChangedPassword!890',
    }, cookie));
    failed(await api('get', '/api/auth/me', undefined, cookie), 401);
    failed(await api('get', '/api/auth/me', undefined, secondCookie), 401);
    assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);
  });

  await t.test('blocking a user immediately revokes sessions/reset links and is audited', async () => {
    succeeded(await api('post', '/api/auth/forgot-password', { email: blocked.email }));
    await resetTokenFor(blocked.email); // Track the private fixture email for cleanup.
    assert.equal(await prisma.passwordReset.count({ where: { userId: blocked.id } }), 1);
    succeeded(await api('patch', `/api/admin/users/${blocked.id}`, { isBlocked: true }, adminCookie));
    assert.equal(await prisma.session.count({ where: { userId: blocked.id } }), 0);
    assert.equal(await prisma.passwordReset.count({ where: { userId: blocked.id } }), 0);
    failed(await api('get', '/api/auth/me', undefined, blockedCookie), 401);
    failed(await api('post', '/api/auth/login', { email: blocked.email, password }), 403);
    assert.equal(await prisma.adminLog.count({ where: { adminId: admin.id, entityId: blocked.id, action: 'user.update' } }), 1);
  });

  await t.test('logout removes the server session and its cookie stops authenticating', async () => {
    succeeded(await api('post', '/api/auth/logout', {}, otherCookie));
    failed(await api('get', '/api/auth/me', undefined, otherCookie), 401);
  });
});
