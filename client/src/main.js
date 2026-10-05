import './styles/main.scss';
import * as api from './api.js';
import { escapeHtml as e, heading, notice } from './ui.js';
import { navigate, startRouter } from './router.js';
import { authView, profileView } from './views/auth.js';
import { homeView, catalogView, productView, plansView, faqView } from './views/catalog.js';
import { dashboardView, subscriptionsView, ordersView, orderView, checkoutView } from './views/account.js';
import { adminView } from './views/admin.js';

const app = document.querySelector('#app');
const state = { user: null };
let renderVersion = 0;
function navLink(path, label) { return `<a data-link href="${path}"${location.pathname === path ? ' aria-current="page"' : ''}>${label}</a>`; }
function shell() {
  return `<a class="skip-link" href="#content">Перейти к содержимому</a>
    <header class="site-header"><div class="container header-inner">
      <a data-link class="brand" href="/" aria-label="HYDRA"><img src="/logo-1.png" alt="" width="52" height="38"><span>HYDRA</span></a>
      <nav class="main-nav" aria-label="Основная навигация">${navLink('/catalog', 'Каталог')}${navLink('/faq', 'FAQ')}</nav>
      <div class="account-nav">${state.user ? `<a data-link class="account-link" href="/dashboard"><span class="account-avatar" aria-hidden="true">${e(state.user.username.slice(0, 1).toUpperCase())}</span><span class="account-username" data-account-name>${e(state.user.username)}</span></a><button type="button" class="secondary compact" id="logout">Выйти</button>` : `<a data-link class="login-link" href="/login">Войти</a><a data-link class="button compact" href="/register">Регистрация</a>`}</div>
    </div></header>
    ${state.user ? `<div class="account-bar"><nav class="container tabs" aria-label="Личный кабинет">${navLink('/dashboard', 'Обзор')}${navLink('/subscriptions', 'Мои подписки')}${navLink('/orders', 'История заказов')}${navLink('/profile', 'Профиль')}${state.user.role === 'admin' ? navLink('/admin', 'Админ-панель') : ''}</nav></div>` : ''}
    <main id="content" class="container" tabindex="-1"><p class="loading" role="status">Загрузка…</p></main>
    <footer class="site-footer"><div class="container footer-inner"><div class="footer-identity"><a data-link class="brand footer-brand" href="/" aria-label="HYDRA"><img src="/logo-1.png" alt="" width="52" height="38"><span>HYDRA</span></a><span class="footer-description">Подписка · цифровые продукты</span></div><a data-link class="footer-support" href="/faq">Помощь и вопросы<span aria-hidden="true">↗</span></a></div></footer>`;
}
const notFound = () => ({ title: 'Страница не найдена', html: `${heading('404 — Страница не найдена', 'Возможно, адрес изменился или ссылка больше не действует.')}<a data-link class="button" href="/">На главную</a>` });
async function resolveView(path) {
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
  const protectedRoute = /^\/(dashboard|subscriptions|orders|profile|checkout|admin)(\/|$)/.test(path);
  if (protectedRoute && !state.user) {
    navigate(`/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`, { replace: true });
    return;
  }
  app.innerHTML = shell();
  const main = app.querySelector('main');
  main.dataset.page = path === '/' ? 'home' : /^\/(catalog|products|plans)(\/|$)/.test(path) ? 'catalog' : path === '/faq' ? 'faq' : /^\/(login|register|forgot-password|reset-password)$/.test(path) ? 'auth' : /^\/admin(\/|$)/.test(path) ? 'admin' : 'account';
  app.querySelector('#logout')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try { await api.logout(); state.user = null; navigate('/login', { replace: true }); }
    catch (error) { main.innerHTML = `${heading('Не удалось выйти')}${notice(error.message, 'error')}<button id="retry">Повторить</button>`; main.querySelector('#retry').addEventListener('click', render); }
  });
  try {
    if (/^\/admin(\/|$)/.test(path) && state.user.role !== 'admin') throw new api.ApiError('Доступ к админ-панели разрешён только администраторам.', 403);
    const view = await resolveView(path);
    if (version !== renderVersion) return;
    document.title = `${view.title} · HYDRA`;
    main.innerHTML = view.html;
    view.bind?.(main);
    window.scrollTo({ top: 0 });
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
