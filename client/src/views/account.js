import * as api from '../api.js';
import { bindForm, date, empty, escapeHtml as e, field, formStatus, heading, money, notice, pagination, report, safeHttpsUrl, status, table } from '../ui.js';
import { navigate } from '../router.js';
import { documentLink, legalNotice } from '../privacy.js';

const orderRows = (items) => items.map((order) => [
  `<a data-link href="/orders/${encodeURIComponent(order.id)}"><code>${e(order.id.slice(0, 8))}</code></a>`,
  e(order.product?.name || order.productId), e(order.plan?.name || order.planId),
  money(order.finalPrice), status(order.status), e(date(order.createdAt)),
]);
const subscriptionRows = (items) => items.map((item) => [e(item.product?.name || item.productId), e(item.plan?.name || item.planId), status(item.status), e(date(item.startsAt)), e(date(item.expiresAt)), item.product?.slug ? `<a data-link href="/products/${encodeURIComponent(item.product.slug)}">Продлить</a>` : '—']);

export async function dashboardView(state) {
  const [subscriptions, orders] = await Promise.all([api.getSubscriptions(), api.getOrders({ pageSize: 5 })]);
  const active = subscriptions.filter((item) => item.status === 'active' && new Date(item.expiresAt) > new Date());
  return { title: 'Личный кабинет', html: `<div class="workspace-page">${heading(`Здравствуйте, ${state.user.username}`, 'Все ваши покупки и подписки в одном месте.')}<div class="stats workspace-stats"><article class="panel workspace-stat workspace-stat--subscriptions"><span>Активные подписки</span><strong>${active.length}</strong></article><article class="panel workspace-stat workspace-stat--orders"><span>Всего заказов</span><strong>${orders.total}</strong></article><article class="panel workspace-stat workspace-stat--balance"><span>Баланс</span><strong>${money(state.user.balance)}</strong><small>Информационный баланс</small></article></div><section class="workspace-section"><div class="section-heading"><h2>Ваш доступ</h2><a data-link href="/subscriptions">Все подписки →</a></div>${active.length ? table(['Продукт', 'Тариф', 'Статус', 'Начало', 'Окончание', 'Действие'], subscriptionRows(active)) : `<div class="workspace-empty">${empty('Активных подписок пока нет.')}<a data-link class="button" href="/catalog">Выбрать продукт</a></div>`}</section><section class="workspace-section"><div class="section-heading"><h2>Последние заказы</h2><a data-link href="/orders">История заказов →</a></div>${table(['Заказ', 'Продукт', 'Тариф', 'Сумма', 'Статус', 'Дата'], orderRows(orders.items))}</section></div>` };
}
export async function subscriptionsView() {
  const items = await api.getSubscriptions();
  return { title: 'Мои подписки', html: `<div class="workspace-page">${heading('Мои подписки', 'Статус и срок доступа к вашим продуктам.')}<section class="workspace-section workspace-section--table">${table(['Продукт', 'Тариф', 'Статус', 'Начало', 'Окончание', 'Действие'], subscriptionRows(items))}</section></div>` };
}
export async function ordersView() {
  const page = Number(new URLSearchParams(location.search).get('page')) || 1;
  const result = await api.getOrders({ page, pageSize: 15 });
  return { title: 'История заказов', html: `<div class="workspace-page">${heading('История заказов', 'Выберите заказ, чтобы проверить оплату и посмотреть подробности.')}<section class="workspace-section workspace-section--table">${table(['Заказ', 'Продукт', 'Тариф', 'Сумма', 'Статус', 'Дата'], orderRows(result.items))}</section>${pagination(result, location.href)}</div>` };
}

function checkoutKey(userId, payload) {
  const storageKey = `checkout:${userId}:${JSON.stringify(payload)}`;
  let value;
  try { value = sessionStorage.getItem(storageKey); } catch { /* Storage may be disabled. */ }
  if (!value) {
    value = crypto.randomUUID();
    try { sessionStorage.setItem(storageKey, value); } catch { /* In-memory value still survives retries. */ }
  }
  return { value, clear: () => { try { sessionStorage.removeItem(storageKey); } catch { /* Optional storage. */ } } };
}
export async function checkoutView(state) {
  const params = new URLSearchParams(location.search);
  if (!params.get('product') || !params.get('plan')) return { title: 'Оформление заказа', html: `<div class="workspace-page">${heading('Выберите тариф')}<div class="panel workspace-panel">${notice('Для оформления заказа сначала выберите продукт и тариф.')}<a data-link class="button" href="/catalog">Открыть каталог</a></div></div>` };
  const product = await api.getProduct(params.get('product'));
  const legal = await api.getLegalConfig(state.user.jurisdiction || 'RU');
  const plan = product.plans.find((item) => item.id === params.get('plan'));
  if (!plan) throw new api.ApiError('Выбранный тариф больше недоступен. Выберите другой тариф.', 404);
  const attempts = new Map();
  return {
    title: 'Оформление заказа',
    html: `<div class="workspace-page">${heading('Оформление заказа', 'Проверьте выбранный продукт и срок доступа.')}<div class="split workspace-split checkout-layout"><section class="panel workspace-panel checkout-summary"><p class="eyebrow">${e(product.name)}</p><h2>${e(plan.name)}</h2><p class="checkout-summary__duration">${e(plan.durationDays)} дней доступа</p><dl class="totals"><div><dt>Стоимость</dt><dd>${money(plan.price)}</dd></div><div><dt>Скидка</dt><dd id="discount">${money(0)}</dd></div><div class="total"><dt>Итого</dt><dd id="total">${money(plan.price)}</dd></div></dl><p class="muted">Если у вас уже есть активная подписка, оплаченный срок добавится к ней.</p><a data-link href="/products/${encodeURIComponent(product.slug)}">Изменить тариф</a></section><section class="panel workspace-panel checkout-payment"><div class="workspace-panel__heading"><h2>Промокод и оплата</h2></div><form id="checkout-form" class="stack">${field('promoCode', 'Промокод', { required: false, maxLength: 50, autocomplete: 'off' })}<button type="button" id="check-promo" class="secondary">Проверить промокод</button><div id="promo-status" role="status" aria-live="polite"></div><p class="checkout-payment__note">Подписка активируется после подтверждения оплаты платёжной системой.</p>${legalNotice(legal)}${!state.user.jurisdiction ? '<p class="notice">Сначала выберите конфигурацию аккаунта в <a data-link href="/privacy-data">Privacy & Data</a>.</p>' : ''}<div class="legal-checkboxes"><label class="legal-checkbox"><input type="checkbox" name="offerAccepted" required><span>Я принимаю ${documentLink('offer', 'Публичную оферту', legal)}</span></label><label class="legal-checkbox"><input type="checkbox" name="refundAcknowledged" required><span>Я ознакомился с ${documentLink('refund-policy', 'Политикой возврата', legal)}</span></label></div>${formStatus()}<button type="submit">Создать заказ</button></form></section></div></div>`,
    bind(root) {
      const form = root.querySelector('#checkout-form');
      const promoMessage = root.querySelector('#promo-status');
      let promoRequest = 0;
      form.elements.promoCode.addEventListener('input', () => {
        promoRequest++;
        root.querySelector('#discount').textContent = money(0);
        root.querySelector('#total').textContent = money(plan.price);
        promoMessage.textContent = '';
      });
      root.querySelector('#check-promo').addEventListener('click', async (event) => {
        const code = form.elements.promoCode.value.trim();
        if (!code) { promoMessage.textContent = 'Введите промокод.'; return; }
        const requestId = ++promoRequest;
        event.currentTarget.disabled = true;
        try {
          const result = await api.checkPromoCode({ planId: plan.id, code });
          if (requestId !== promoRequest) return;
          root.querySelector('#discount').textContent = money(result.discount);
          root.querySelector('#total').textContent = money(result.finalPrice);
          promoMessage.textContent = 'Промокод доступен. Итоговая скидка будет подтверждена при создании заказа.';
        } catch (error) { if (requestId === promoRequest) promoMessage.textContent = error.message; }
        finally { root.querySelector('#check-promo').disabled = false; }
      });
      bindForm(form, async (values) => {
        const payload = { productId: product.id, planId: plan.id, ...(values.promoCode.trim() ? { promoCode: values.promoCode.trim() } : {}) };
        const fingerprint = JSON.stringify(payload);
        if (!attempts.has(fingerprint)) attempts.set(fingerprint, checkoutKey(state.user.id, payload));
        const attempt = attempts.get(fingerprint);
        const order = await api.createOrder({ ...payload, idempotencyKey: attempt.value, offerAccepted: form.elements.offerAccepted.checked, refundAcknowledged: form.elements.refundAcknowledged.checked, offerDocumentId: legal.documents.find(item => item.kind === 'offer').id, refundDocumentId: legal.documents.find(item => item.kind === 'refund-policy').id });
        attempt.clear();
        navigate(`/orders/${encodeURIComponent(order.id)}`, { replace: true });
      });
    },
  };
}
export async function orderView(orderId) {
  const order = await api.getOrder(orderId);
  const payment = order.payment;
  const checkoutUrl = safeHttpsUrl(payment?.checkoutUrl);
  return {
    title: `Заказ ${order.id.slice(0, 8)}`,
    html: `<div class="workspace-page"><p class="workspace-back"><a data-link href="/orders">← История заказов</a></p>${heading(`Заказ ${order.id.slice(0, 8)}`, `Создан ${date(order.createdAt)}`)}<div class="split workspace-split checkout-layout"><section class="panel workspace-panel checkout-summary"><h2>${e(order.product?.name || 'Продукт')}</h2><p class="checkout-summary__duration">${e(order.plan?.name || 'Тариф')} · ${e(order.durationDays || order.plan?.durationDays || '')} дней</p><p>${status(order.status)}</p><dl class="totals"><div><dt>Стоимость</dt><dd>${money(order.originalPrice)}</dd></div><div><dt>Скидка</dt><dd>${money(order.discount)}</dd></div><div class="total"><dt>Итого</dt><dd>${money(order.finalPrice)}</dd></div></dl><p class="muted checkout-summary__id">Номер заказа: <code>${e(order.id)}</code></p></section><section class="panel workspace-panel checkout-payment"><div class="workspace-panel__heading"><h2>Оплата</h2></div>${order.status === 'paid' ? `${notice('Оплата подтверждена. Подписка активирована.')}<a data-link class="button" href="/subscriptions">Мои подписки</a>` : order.status === 'pending' ? `<p>Заказ ожидает подтверждения оплаты. После оплаты обновите статус.</p>${order.expiresAt ? `<p>Оплатите до ${e(date(order.expiresAt))}.</p>` : ''}${payment?.provider === 'sandbox' ? notice('Тестовый платёж: заказ ожидает подтверждения от тестовой платёжной системы.') : ''}${checkoutUrl ? `<p><a class="button" href="${e(checkoutUrl)}" target="_blank" rel="noopener noreferrer">Перейти к оплате ↗</a></p>` : ''}<form id="cancel-form" class="stack">${formStatus()}<div class="actions"><button type="button" id="refresh-order">Обновить статус</button><button type="submit" class="secondary">Отменить заказ</button></div></form>` : `<p>Текущий статус: ${status(order.status)}</p><a data-link href="/catalog">Вернуться в каталог</a>`}${payment ? `<p class="muted checkout-payment__id">Платёж: <code>${e(payment.id)}</code></p>` : ''}</section></div></div>`,
    bind(root) {
      root.querySelector('#refresh-order')?.addEventListener('click', () => navigate(location.pathname, { replace: true }));
      const form = root.querySelector('#cancel-form');
      if (form) bindForm(form, async () => { await api.cancelOrder(order.id); navigate(location.pathname, { replace: true }); });
    },
  };
}
