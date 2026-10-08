import './styles/main.scss';
import * as api from './api.js';
import { escapeHtml as e, heading, money, notice } from './ui.js';
import { navigate, startRouter } from './router.js';
import { authView, profileView } from './views/auth.js';
import { homeView, catalogView, productView, plansView, faqView } from './views/catalog.js';
import { dashboardView, subscriptionsView, ordersView, orderView, checkoutView } from './views/account.js';
import { adminView } from './views/admin.js';
import { bindAccountDropdown, bindPageMotion, closeAccountDropdown, scrollToSection } from './motion.js';
import { refreshPrivacy, currentLegal } from './privacy.js';
import { legalView, privacyView } from './views/legal.js';
import { DOCUMENTS } from '../../shared/legal.js';

const app = document.querySelector('#app');
const state = { user: null };
let renderVersion = 0;
let renderedLocation = null;
function navLink(path, label) {
  const target = new URL(path, location.origin);
  const current = location.pathname === target.pathname && (!target.hash || location.hash === target.hash);
  return `<a data-link href="${path}"${current ? ' aria-current="page"' : ''}>${label}</a>`;
}
function accountDropdown() {
  return `<details class="account-dropdown"><summary class="account-trigger" aria-controls="account-menu" title="${e(state.user.username)}"><span class="account-avatar" aria-hidden="true">${e(state.user.username.slice(0, 1).toUpperCase())}</span><span class="account-username" data-account-name>${e(state.user.username)}</span><span class="account-chevron" aria-hidden="true"></span></summary><div id="account-menu" class="account-menu"><div class="account-menu__heading"><span>Личный кабинет</span><div><span>Баланс</span><strong>${money(state.user.balance)}</strong></div></div><nav class="account-menu__links" aria-label="Личный кабинет">${navLink('/dashboard', 'Обзор')}${navLink('/subscriptions', 'Мои подписки')}${navLink('/orders', 'История заказов')}${navLink('/profile', 'Профиль')}${navLink('/privacy-data', 'Privacy & Data')}${state.user.role === 'admin' ? navLink('/admin', 'Админ-панель') : ''}</nav><div class="account-menu__footer"><button type="button" id="logout">Выйти<span aria-hidden="true">↗</span></button></div></div></details>`;
}
document.addEventListener('pointerdown', (event) => {
  const dropdown = app.querySelector('.account-dropdown[open]');
  if (dropdown && !dropdown.contains(event.target)) closeAccountDropdown(dropdown);
});
document.addEventListener('keydown', (event) => {
  const dropdown = app.querySelector('.account-dropdown[open]');
  if (event.key === 'Escape' && dropdown) {
    closeAccountDropdown(dropdown);
    dropdown.querySelector('summary').focus();
  }
});
function shell() {
  return `<a class="skip-link" href="#content">Перейти к содержимому</a>
    <header class="site-header"><div class="container header-inner">
      <a data-link class="brand" href="/" aria-label="HYDRA"><img src="/logo-1.png" alt="" width="52" height="38"><span>HYDRA</span></a>
      <nav class="main-nav" aria-label="Основная навигация">${navLink('/catalog', 'Каталог')}${navLink('/#showcase', 'Примеры работы')}${navLink('/#how-it-works', 'Как это работает')}${navLink('/faq', 'FAQ')}</nav>
      <div class="account-nav">${state.user ? accountDropdown() : `<a data-link class="login-link" href="/login">Войти</a><a data-link class="button compact" href="/register">Регистрация</a>`}</div>
    </div></header>
    <main id="content" class="container" tabindex="-1"><p class="loading" role="status">Загрузка…</p></main>
    <footer class="site-footer"><div class="container footer-inner"><div class="footer-identity"><a data-link class="brand footer-brand" href="/" aria-label="HYDRA"><img src="/logo-1.png" alt="" width="52" height="38"><span>HYDRA</span></a><span class="footer-description">© HYDRA ${new Date().getFullYear()} · цифровые продукты</span></div><a data-link class="footer-support" href="/faq">Помощь и вопросы<span aria-hidden="true">↗</span></a></div><div class="container footer-legal"><nav aria-label="Юридическая информация">${Object.entries(DOCUMENTS).filter(([kind]) => !['user-consent', 'marketing-consent'].includes(kind)).map(([kind, label]) => `<a data-link href="/${kind}?jurisdiction=${e(state.user?.jurisdiction || 'RU')}">${e(label)}</a>`).join('')}<button type="button" class="text-button" data-cookie-settings>Cookie Settings</button></nav><p>[ФИО / НАИМЕНОВАНИЕ ОПЕРАТОРА] · [ИНН / БИН / РЕГИСТРАЦИОННЫЙ НОМЕР] · [EMAIL]</p></div></footer>`;
}
const notFound = () => ({ title: 'Страница не найдена', html: `${heading('404 — Страница не найдена', 'Возможно, адрес изменился или ссылка больше не действует.')}<a data-link class="button" href="/">На главную</a>` });
async function resolveView(path) {
  if (Object.hasOwn(DOCUMENTS, path.slice(1))) return legalView(path.slice(1));
  if (path === '/privacy-data') return privacyView(state);
  if (path === '/') return homeView();
  if (path === '/catalog' || path === '/products') return catalogView();
  if (/^\/products\/[^/]+$/.test(path)) return productView(decodeURIComponent(path.split('/')[2]));
  if (path === '/plans') return plansView();
  if (path === '/faq') return faqView();
  if (['/login', '/register', '/forgot-password', '/reset-password'].includes(path)) return authView(path.slice(1), state);
  if (path === '/dashboard') return dashboardView(state);
  if (path === '/subscriptions') return subscriptionsView();
  if (path === '/orders') return ordersView();
  if (/^\/orders\/[^/]+$/.test(path)) return orderView(path.split('/')[2]);
  if (path === '/profile') return profileView(state);
  if (path === '/checkout') return checkoutView(state);
  if (path === '/admin' || /^\/admin\/[^/]+$/.test(path)) return adminView(path.split('/')[2] || 'dashboard');
  return notFound();
}
async function render() {
  const version = ++renderVersion;
  const path = location.pathname.replace(/\/$/, '') || '/';
  const currentMain = app.querySelector('main[data-ready="true"]');
  if (currentMain && renderedLocation?.path === path && renderedLocation.search === location.search && (location.hash || renderedLocation.hash)) {
    const section = location.hash ? currentMain.querySelector(`[id="${CSS.escape(location.hash.slice(1))}"]`) : null;
    if (section || !location.hash) {
      app.querySelectorAll('.main-nav a').forEach((link) => {
        const target = new URL(link.href);
        if (target.pathname === location.pathname && (!target.hash || target.hash === location.hash)) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
      scrollToSection(section);
      currentMain.focus({ preventScroll: true });
      renderedLocation.hash = location.hash;
      return;
    }
  }
  const protectedRoute = /^\/(dashboard|subscriptions|orders|profile|checkout|admin|privacy-data)(\/|$)/.test(path);
  if (protectedRoute && !state.user) {
    navigate(`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`, { replace: true });
    return;
  }
  app.innerHTML = shell();
  const main = app.querySelector('main');
  main.dataset.page = path === '/' ? 'home' : /^\/(catalog|products|plans)(\/|$)/.test(path) ? 'catalog' : path === '/faq' ? 'faq' : /^\/(login|register|forgot-password|reset-password)$/.test(path) ? 'auth' : /^\/admin(\/|$)/.test(path) ? 'admin' : 'account';
  bindAccountDropdown(app.querySelector('.account-dropdown'));
  app.querySelector('#logout')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try { await api.logout(); state.user = null; navigate('/login', { replace: true }); }
    catch (error) { main.innerHTML = `${heading('Не удалось выйти')}${notice(error.message, 'error')}<button id="retry">Повторить</button>`; main.querySelector('#retry').addEventListener('click', render); }
  });
  try {
    await refreshPrivacy(state.user);
    const operator = currentLegal().settings.operator;
    app.querySelector('.footer-legal > p').textContent = `${operator.name} · ${operator.registration} · ${operator.email}`;
    if (version !== renderVersion) return;
    if (/^\/admin(\/|$)/.test(path) && state.user.role !== 'admin') throw new api.ApiError('Доступ к админ-панели разрешён только администраторам.', 403);
    const view = await resolveView(path);
    if (version !== renderVersion) return;
    document.title = `${view.title} · HYDRA`;
    main.innerHTML = view.html;
    view.bind?.(main);
    main.dataset.ready = 'true';
    main.classList.add('page-enter');
    renderedLocation = { path, search: location.search, hash: location.hash };
    window.scrollTo({ top: 0, behavior: 'instant' });
    bindPageMotion(main);
    const section = location.hash ? main.querySelector(`[id="${CSS.escape(location.hash.slice(1))}"]`) : null;
    if (section) scrollToSection(section);
    main.focus({ preventScroll: true });
  } catch (error) {
    if (version !== renderVersion) return;
    if (error.status === 401 && protectedRoute) {
      state.user = null;
      navigate(`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`, { replace: true });
      return;
    }
    const title = error.status === 403 ? '403 — Доступ запрещён' : error.status === 404 ? '404 — Не найдено' : 'Не удалось загрузить страницу';
    document.title = `${title} · HYDRA`;
    main.innerHTML = `${heading(title)}${notice(error.message || 'Произошла ошибка. Попробуйте ещё раз.', 'error')}<div class="actions"><button id="retry">Повторить</button><a data-link class="button secondary" href="/">На главную</a></div>`;
    main.querySelector('#retry').addEventListener('click', render);
  }
}

async function bootstrap() {
  app.innerHTML = '<p class="loading" role="status">Проверяем сеанс…</p>';
  try { state.user = await api.getCurrentUser(); }
  catch (error) {
    if (error.status === 401) state.user = null;
    else {
      app.innerHTML = `<main class="container narrow">${heading('Не удалось подключиться')}${notice(error.message, 'error')}<button id="retry-bootstrap">Повторить подключение</button></main>`;
      app.querySelector('#retry-bootstrap').addEventListener('click', bootstrap);
      return;
    }
  }
  startRouter(render);
}
bootstrap();
