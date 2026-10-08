import * as api from '../api.js';
import { mediaImage } from '../privacy.js';
import { empty, escapeHtml as e, heading, money, pagination } from '../ui.js';

export const productCard = (product) => `<article class="panel product-card"><p class="eyebrow">Цифровой продукт</p><h2><a data-link href="/products/${encodeURIComponent(product.slug)}">${e(product.name)}</a></h2><p>${e(product.shortDescription)}</p><div class="card-bottom">${product.plans?.length ? `<p class="price">от ${money(Math.min(...product.plans.map((plan) => Number(plan.price))))}</p>` : '<p class="muted">Тарифы скоро появятся</p>'}<a data-link class="button secondary" href="/products/${encodeURIComponent(product.slug)}">Подробнее</a></div></article>`;
const planCard = (plan, product) => `<article class="panel plan-card"><div class="plan-card__header"><p class="eyebrow">${e(product.name)}</p><span class="plan-card__symbol" aria-hidden="true">↗</span></div><h3>${e(plan.name)}</h3><p class="plan-card__duration">${e(plan.durationDays)} дней доступа</p><div class="plan-card__bottom"><p class="price">${money(plan.price)}</p><a data-link class="button" href="/checkout?product=${encodeURIComponent(product.slug)}&plan=${encodeURIComponent(plan.id)}">Выбрать тариф</a></div></article>`;
const durationLabel = (value) => {
  const days = Number(value);
  if (days === 1) return '24 ч';
  const mod10 = days % 10;
  const mod100 = days % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'день' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'дня' : 'дней';
  return `${days} ${word}`;
};
const checkoutUrl = (product, plan) => `/checkout?product=${encodeURIComponent(product.slug)}&plan=${encodeURIComponent(plan.id)}`;
const catalogProductCard = (product, index = 0) => {
  const plans = product.plans || [];
  const selected = plans[0];
  const visual = product.image
    ? mediaImage(product.image)
    : `<span aria-hidden="true">${e(product.name.slice(0, 1).toUpperCase())}</span>`;
  const picker = plans.length
    ? `<fieldset class="plan-picker"><legend>Срок доступа</legend><div class="plan-options">${plans.map((plan, index) => `<label class="plan-option"><input type="radio" name="plan-${e(product.id)}" value="${e(plan.id)}" data-price="${e(plan.price)}" data-checkout="${e(checkoutUrl(product, plan))}"${index === 0 ? ' checked' : ''}><span>${durationLabel(plan.durationDays)}</span></label>`).join('')}</div></fieldset>`
    : '<p class="muted catalog-unavailable">Тарифы для этого продукта скоро появятся.</p>';
  const purchase = selected
    ? `<div class="catalog-product__bottom"><div><span class="eyebrow">К оплате</span><strong class="catalog-price" data-plan-price>${money(selected.price)}</strong></div><a data-link class="button catalog-buy" data-buy-link href="${e(checkoutUrl(product, selected))}">Купить</a></div>`
    : '';
  return `<article class="panel catalog-product" data-product-card><div class="catalog-product__topline" aria-hidden="true"><span>${String(index + 1).padStart(2, '0')}</span><span class="catalog-product__signal"></span></div><div class="catalog-product__identity"><div class="catalog-product__visual">${visual}</div><h2><a data-link href="/products/${encodeURIComponent(product.slug)}">${e(product.name)}</a></h2><p class="catalog-product__description">${e(product.shortDescription)}</p></div><div class="catalog-product__configuration">${picker}${purchase}</div><a data-link class="catalog-details" href="/products/${encodeURIComponent(product.slug)}">Подробнее о продукте →</a></article>`;
};
const bindCatalog = (root) => {
  root.querySelectorAll('[data-product-card]').forEach((card) => {
    card.addEventListener('change', (event) => {
      const input = event.target.closest('input[type="radio"][data-price]');
      if (!input) return;
      const price = card.querySelector('[data-plan-price]');
      const buy = card.querySelector('[data-buy-link]');
      if (price) price.textContent = money(input.dataset.price);
      if (buy) buy.href = input.dataset.checkout;
    });
  });
};

export async function homeView() {
  const result = await api.getProducts({ pageSize: 3 });
  return {
    title: 'Главная',
    html: `<div class="storefront home-page">
      <section class="hero hydra-hero">
        <div class="hydra-hero__copy"><p class="eyebrow"><span class="status-dot" aria-hidden="true"></span>DLC для RAGE:MP / ALT:V</p><h1>HYDRA</h1><p class="hydra-hero__description">Выберите продукт и подходящий срок доступа. Все покупки и подписки — в одном личном кабинете.</p><div class="actions"><a data-link class="button hero-cta" href="/catalog">Открыть весь каталог<span aria-hidden="true">↗</span></a><a data-link class="hero-preview-link" href="/#showcase">Посмотреть примеры<span aria-hidden="true">↓</span></a></div></div>
        <figure class="hero-demo" id="video-review"><div class="hero-demo__top"><span><span class="status-dot" aria-hidden="true"></span>HYDRA / демонстрация</span><span class="media-tag">ВИДЕО</span></div><div class="media-placeholder media-placeholder--video"><div class="media-placeholder__grid" aria-hidden="true"></div><span class="media-placeholder__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m9 6 9 6-9 6V6Z" fill="currentColor"/></svg></span><div class="media-placeholder__copy"><strong>Видеообзор</strong><span>Место для видео с примером работы</span></div><span class="media-placeholder__corner media-placeholder__corner--top" aria-hidden="true"></span><span class="media-placeholder__corner media-placeholder__corner--bottom" aria-hidden="true"></span></div><figcaption><span>RAGE:MP / ALT:V</span><span>Видео ещё не добавлено</span></figcaption></figure>
        <div class="hydra-hero__baseline" aria-hidden="true"><span></span><span></span><span></span></div>
      </section>
      <section class="storefront-products"><div class="section-heading"><h2>Продукты и тарифы</h2><a data-link href="/catalog">Весь каталог →</a></div><div class="catalog-products">${result.items.map(catalogProductCard).join('') || empty('Каталог скоро появится.')}</div></section>
      <section class="showcase" id="showcase"><div class="section-heading"><div><p class="eyebrow">Визуально о продукте</p><h2>Примеры работы</h2></div><a data-link href="/#video-review">Видеообзор ↑</a></div><div class="showcase-grid">${['RAGE:MP', 'ALT:V'].map((platform, index) => `<figure class="showcase-card"><div class="media-placeholder media-placeholder--photo"><div class="media-placeholder__grid" aria-hidden="true"></div><span class="media-placeholder__index" aria-hidden="true">0${index + 1}</span><span class="media-tag">ФОТО</span><span class="media-placeholder__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="10" r="1.5" fill="currentColor"/><path d="m4 17 5-4 3 2 4-5 4 5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></span><div class="media-placeholder__copy"><strong>${platform}</strong><span>Место для скриншота работы продукта</span></div></div><figcaption><span>${platform}</span><span>Фото ещё не добавлено</span></figcaption></figure>`).join('')}</div></section>
      <section class="panel steps" id="how-it-works"><div class="steps__heading"><h2>Как это работает</h2><img src="/logo-1.png" alt="" aria-hidden="true" loading="lazy"></div><ol><li><span class="steps__number" aria-hidden="true">01</span><span>Выберите продукт и тариф.</span></li><li><span class="steps__number" aria-hidden="true">02</span><span>Войдите в аккаунт и оформите заказ.</span></li><li><span class="steps__number" aria-hidden="true">03</span><span>После подтверждения оплаты доступ появится в разделе «Мои подписки».</span></li></ol></section>
    </div>`,
    bind: bindCatalog,
  };
}
export async function catalogView() {
  const page = Number(new URLSearchParams(location.search).get('page')) || 1;
  const result = await api.getProducts({ page, pageSize: 12 });
  return {
    title: 'Каталог',
    html: `<div class="storefront catalog-page"><header class="catalog-heading"><div><p class="eyebrow"><span class="status-dot" aria-hidden="true"></span>Каталог и тарифы</p><h1>Выберите продукт</h1><p>Выберите продукт и срок доступа — цена обновится автоматически.</p></div><span class="catalog-heading__symbol" aria-hidden="true">↙</span></header><div class="catalog-products">${result.items.map(catalogProductCard).join('') || empty('Пока нет доступных продуктов.')}</div>${pagination(result, location.href)}</div>`,
    bind: bindCatalog,
  };
}
export async function productView(slug) {
  const product = await api.getProduct(slug);
  return { title: product.name, html: `<div class="storefront product-page"><p class="storefront-back"><a data-link href="/catalog">← Каталог</a></p><div class="product-overview"><div class="product-overview__copy">${heading(product.name, product.shortDescription)}</div><div class="product-overview__visual">${product.image ? mediaImage(product.image) : `<span>${e(product.name.slice(0, 1).toUpperCase())}</span>`}</div></div><section class="panel product-description"><h2>Описание</h2><p class="preserve-lines">${e(product.description)}</p></section><section class="product-plans"><div class="section-heading"><h2>Выберите срок доступа</h2></div><div class="grid">${product.plans.map((plan) => planCard(plan, product)).join('') || empty('Для этого продукта пока нет доступных тарифов.')}</div></section></div>` };
}
export async function plansView() {
  return catalogView();
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
  return { title: 'FAQ', html: `<div class="storefront faq-page"><div class="faq-page__heading">${heading('Частые вопросы')}<img src="/logo-1.png" alt="" aria-hidden="true" loading="lazy"></div><div class="faq-list">${questions.map(([q, a], index) => `<details class="panel faq-item"><summary><span class="faq-item__number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><span>${e(q)}</span><span class="faq-item__toggle" aria-hidden="true"></span></summary><p>${e(a)}</p></details>`).join('')}</div></div>` };
}
