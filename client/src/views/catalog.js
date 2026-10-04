import * as api from '../api.js';
import { empty, escapeHtml as e, heading, money, pagination } from '../ui.js';

export const productCard = (product) => `<article class="panel product-card"><p class="eyebrow">Цифровой продукт</p><h2><a data-link href="/products/${encodeURIComponent(product.slug)}">${e(product.name)}</a></h2><p>${e(product.shortDescription)}</p><div class="card-bottom">${product.plans?.length ? `<p class="price">от ${money(Math.min(...product.plans.map((plan) => Number(plan.price))))}</p>` : '<p class="muted">Тарифы скоро появятся</p>'}<a data-link class="button secondary" href="/products/${encodeURIComponent(product.slug)}">Подробнее</a></div></article>`;
const planCard = (plan, product) => `<article class="panel plan-card"><p class="eyebrow">${e(product.name)}</p><h3>${e(plan.name)}</h3><p>${e(plan.durationDays)} дней доступа</p><p class="price">${money(plan.price)}</p><a data-link class="button" href="/checkout?product=${encodeURIComponent(product.slug)}&plan=${encodeURIComponent(plan.id)}">Выбрать тариф</a></article>`;

export async function homeView() {
  const result = await api.getProducts({ pageSize: 3 });
  return { title: 'HYDRA', html: `<section class="hero"><p class="eyebrow">Подписка</p><h1>Ваши цифровые продукты.<br>Удобный доступ по подписке.</h1><p>Выберите продукт и подходящий срок доступа. Все покупки и подписки — в одном личном кабинете.</p><div class="actions"><a data-link class="button" href="/catalog">Открыть каталог</a><a data-link class="button secondary" href="/plans">Посмотреть тарифы</a></div></section><section><div class="section-heading"><h2>Продукты</h2><a data-link href="/catalog">Весь каталог →</a></div><div class="grid">${result.items.map(productCard).join('') || empty('Каталог скоро появится.')}</div></section><section class="panel steps"><h2>Как это работает</h2><ol><li>Выберите продукт и тариф.</li><li>Войдите в аккаунт и оформите заказ.</li><li>После подтверждения оплаты доступ появится в разделе «Мои подписки».</li></ol></section>` };
}
export async function catalogView() {
  const page = Number(new URLSearchParams(location.search).get('page')) || 1;
  const result = await api.getProducts({ page, pageSize: 12 });
  return { title: 'Каталог', html: `${heading('Каталог', 'Выберите продукт, чтобы посмотреть описание и сроки доступа.')}<div class="grid">${result.items.map(productCard).join('') || empty('Пока нет доступных продуктов.')}</div>${pagination(result, location.href)}` };
}
export async function productView(slug) {
  const product = await api.getProduct(slug);
  return { title: product.name, html: `<p><a data-link href="/catalog">← Каталог</a></p>${heading(product.name, product.shortDescription)}<section class="panel"><h2>Описание</h2><p class="preserve-lines">${e(product.description)}</p></section><section><h2>Выберите срок доступа</h2><div class="grid">${product.plans.map((plan) => planCard(plan, product)).join('') || empty('Для этого продукта пока нет доступных тарифов.')}</div></section>` };
}
export async function plansView() {
  const page = Number(new URLSearchParams(location.search).get('page')) || 1;
  const result = await api.getProducts({ page, pageSize: 12 });
  return { title: 'Тарифы', html: `${heading('Тарифы', 'Доступ на выбранный срок. Продление оформляется новой покупкой.')}${result.items.map((product) => `<section><h2>${e(product.name)}</h2><div class="grid">${product.plans.map((plan) => planCard(plan, product)).join('') || empty('Тарифы пока недоступны.')}</div></section>`).join('') || empty('Тарифов пока нет.')}${pagination(result, location.href)}` };
}
export function faqView() {
  const questions = [
    ['Когда активируется подписка?', 'Подписка появляется после того, как платёжная система подтвердит оплату. Статус заказа можно обновить на странице заказа.'],
    ['Как продлить доступ?', 'Выберите тариф того же продукта и оформите новый заказ. Если доступ ещё активен, оплаченный срок добавится к текущей дате окончания.'],
    ['Есть ли автоматические списания?', 'В базовой версии автоматического продления и регулярных списаний нет. Для продления оформляется новый заказ.'],
    ['Где применить промокод?', 'Введите код при оформлении заказа и нажмите «Проверить». Доступность скидки ещё раз проверяется при создании заказа.'],
    ['Где посмотреть срок доступа?', 'Откройте раздел «Мои подписки» в личном кабинете. Там указан статус и дата окончания доступа.'],
    ['Как восстановить пароль?', 'На странице входа нажмите «Забыли пароль?», укажите email и перейдите по ссылке в письме.'],
    ['Можно ли отменить неоплаченный заказ?', 'Откройте неоплаченный заказ в истории покупок и нажмите «Отменить заказ».'],
  ];
  return { title: 'FAQ', html: `${heading('Частые вопросы')}<div class="narrow align-left">${questions.map(([q, a]) => `<details class="panel"><summary>${e(q)}</summary><p>${e(a)}</p></details>`).join('')}</div>` };
}
