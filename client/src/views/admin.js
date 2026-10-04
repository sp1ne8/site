import * as api from '../api.js';
import { bindForm, date, escapeHtml as e, field, formStatus, heading, localDateTime, money, pagination, report, status, table } from '../ui.js';
import { navigate } from '../router.js';

const sections = { dashboard: 'Обзор', users: 'Пользователи', products: 'Продукты', plans: 'Тарифы', subscriptions: 'Подписки', orders: 'Заказы', promocodes: 'Промокоды', payments: 'Платежи', logs: 'Журнал действий' };
const editable = ['products', 'plans', 'promocodes', 'subscriptions'];
const asText = (value) => e(value ?? '—');
const asId = (value) => `<code>${e(value)}</code>`;
const userCell = (user, id) => user ? `${e(user.username)}<small>${e(user.email)}</small>` : asId(id);
const nav = (section) => `<nav class="tabs" aria-label="Разделы админ-панели">${Object.entries(sections).map(([key, label]) => `<a data-link href="/admin${key === 'dashboard' ? '' : `/${key}`}"${section === key ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
const selectField = (name, label, options, value) => `<label>${e(label)}<select name="${e(name)}">${options.map(([v, labelText]) => `<option value="${e(v)}"${String(v) === String(value) ? ' selected' : ''}>${e(labelText)}</option>`).join('')}</select></label>`;
const checkbox = (name, label, value = true) => `<label class="checkbox"><input type="checkbox" name="${e(name)}"${value ? ' checked' : ''}>${e(label)}</label>`;
const textArea = (name, label, value = '', maxLength = 10000) => `<label>${e(label)}<textarea name="${e(name)}" required maxlength="${maxLength}" rows="4">${e(value)}</textarea></label>`;
const idField = (name, label, value, list) => `<label>${e(label)}<input name="${name}" required value="${e(value || '')}" list="${list}" autocomplete="off" placeholder="UUID"><small>Выберите подсказку или вставьте ID из соответствующего раздела.</small></label>`;

function editorFields(section, item = {}) {
  if (section === 'products') return field('name', 'Название', { value: item.name, maxLength: 150 }) + field('slug', 'Slug', { value: item.slug, pattern: '[a-z0-9]+(?:-[a-z0-9]+)*', help: 'Латинские буквы в нижнем регистре, цифры, дефисы.', maxLength: 160 }) + field('shortDescription', 'Краткое описание', { value: item.shortDescription, maxLength: 500 }) + textArea('description', 'Описание', item.description) + field('image', 'Ссылка на изображение', { value: item.image, required: false, maxLength: 2048, help: 'URL http(s) или путь /images/file.png.' }) + checkbox('isActive', 'Продукт доступен', item.isActive ?? true);
  if (section === 'plans') return idField('productId', 'ID продукта', item.productId, 'product-options') + field('name', 'Название тарифа', { value: item.name, maxLength: 100 }) + field('durationDays', 'Срок, дней', { value: item.durationDays ?? 30, type: 'number', min: 1, max: 3650, step: 1 }) + field('price', 'Цена, ₽', { value: item.price ?? '0.00', type: 'number', min: 0, step: '0.01', max: '9999999999.99' }) + checkbox('isActive', 'Тариф доступен', item.isActive ?? true);
  if (section === 'promocodes') return field('code', 'Промокод', { value: item.code, minLength: 3, maxLength: 50, pattern: '[A-Za-z0-9_-]+' }) + selectField('type', 'Тип скидки', [['percent', 'Процент'], ['fixed', 'Сумма, ₽']], item.type || 'percent') + field('value', 'Значение скидки', { value: item.value ?? '10', type: 'number', min: '0.01', step: '0.01', help: 'Для процентной скидки — не больше 100.' }) + field('maxUses', 'Лимит использований', { value: item.maxUses ?? '', type: 'number', required: false, min: 1, step: 1, help: 'Оставьте пустым для неограниченного использования.' }) + field('expiresAt', 'Действует до', { value: localDateTime(item.expiresAt), type: 'datetime-local', required: false, help: 'В вашем часовом поясе. Пустое поле — без ограничения срока.' }) + checkbox('isActive', 'Промокод включён', item.isActive ?? true);
  if (section === 'subscriptions') return (item.id ? `<p>ID подписки: ${asId(item.id)}</p>${selectField('status', 'Статус', [['active', 'Активна'], ['expired', 'Истекла'], ['cancelled', 'Отменена']], item.status)}` : idField('userId', 'ID пользователя', '', 'user-options') + idField('productId', 'ID продукта', '', 'product-options') + idField('planId', 'ID тарифа', '', 'plan-options')) + field('expiresAt', 'Окончание доступа', { value: localDateTime(item.expiresAt), type: 'datetime-local', help: 'В вашем часовом поясе. Для активной подписки укажите будущую дату.' });
  return '';
}
function editorPayload(section, values, form, editing) {
  const body = { ...values };
  if (['products', 'plans', 'promocodes'].includes(section)) body.isActive = form.elements.isActive.checked;
  if (section === 'products') body.image = values.image.trim() || null;
  if (section === 'plans') body.durationDays = Number(values.durationDays);
  if (section === 'promocodes') {
    body.maxUses = values.maxUses === '' ? null : Number(values.maxUses);
    body.expiresAt = values.expiresAt ? new Date(values.expiresAt).toISOString() : null;
    if (values.type === 'percent' && Number(values.value) > 100) throw new Error('Процент скидки не может превышать 100.');
  }
  if (section === 'subscriptions') {
    body.expiresAt = new Date(values.expiresAt).toISOString();
    if (!editing) delete body.status;
  }
  return body;
}
function actionButton(action, id, label, extra = '') { return `<button type="button" class="secondary compact" data-action="${action}" data-id="${e(id)}" ${extra}>${e(label)}</button>`; }
function getTable(section, items) {
  switch (section) {
    case 'users': return table(['Пользователь', 'ID', 'Роль', 'Доступ', 'Создан', 'Действия'], items.map((item) => [userCell(item, item.id), asId(item.id), asText(item.role), item.isBlocked ? 'Заблокирован' : 'Открыт', e(date(item.createdAt)), `<div class="actions">${actionButton('block', item.id, item.isBlocked ? 'Разблокировать' : 'Заблокировать')}${actionButton('role', item.id, item.role === 'admin' ? 'Сделать пользователем' : 'Сделать администратором')}</div>`]));
    case 'products': return table(['Продукт', 'ID / Slug', 'Доступ', 'Действия'], items.map((item) => [asText(item.name), `${asId(item.id)}<small>${e(item.slug)}</small>`, item.isActive ? 'Включён' : 'Отключён', `<div class="actions">${actionButton('edit', item.id, 'Редактировать')}${item.isActive ? actionButton('deactivate', item.id, 'Отключить') : ''}</div>`]));
    case 'plans': return table(['Тариф', 'ID / продукт', 'Срок', 'Цена', 'Доступ', 'Действия'], items.map((item) => [asText(item.name), `${asId(item.id)}<small>${e(item.product?.name || item.productId)}</small>`, `${e(item.durationDays)} дн.`, money(item.price), item.isActive ? 'Включён' : 'Отключён', actionButton('edit', item.id, 'Редактировать')]));
    case 'promocodes': return table(['Код', 'Скидка', 'Использовано / лимит', 'Бронь', 'Окончание', 'Доступ', 'Действия'], items.map((item) => [asText(item.code), item.type === 'percent' ? `${e(item.value)}%` : money(item.value), `${e(item.usedCount)} / ${item.maxUses == null ? '∞' : e(item.maxUses)}`, e(item.reservedCount ?? 0), e(date(item.expiresAt)), item.isActive ? 'Включён' : 'Отключён', actionButton('edit', item.id, 'Редактировать')]));
    case 'subscriptions': return table(['Пользователь', 'Продукт / тариф', 'ID', 'Статус', 'Окончание', 'Действия'], items.map((item) => [userCell(item.user, item.userId), `${e(item.product?.name || item.productId)}<small>${e(item.plan?.name || item.planId)}</small>`, asId(item.id), status(item.status), e(date(item.expiresAt)), `<div class="actions">${actionButton('edit', item.id, 'Изменить')}${item.status !== 'cancelled' ? actionButton('cancel', item.id, 'Отменить') : ''}</div>`]));
    case 'orders': return table(['Заказ', 'Пользователь', 'Продукт / тариф', 'Сумма', 'Статус', 'Создан'], items.map((item) => [asId(item.id), userCell(item.user, item.userId), `${e(item.product?.name || item.productId)}<small>${e(item.plan?.name || item.planId)}</small>`, money(item.finalPrice), status(item.status), e(date(item.createdAt))]));
    case 'payments': return table(['Платёж', 'Заказ', 'Провайдер', 'Сумма', 'Статус', 'Создан'], items.map((item) => [asId(item.id), asId(item.orderId), asText(item.provider), money(item.amount), status(item.status), e(date(item.createdAt))]));
    case 'logs': return table(['Время', 'Администратор', 'Действие', 'Объект', 'Подробности'], items.map((item) => [e(date(item.createdAt)), userCell(item.admin, item.adminId), asText(item.action), `${e(item.entity)}<small>${e(item.entityId || '')}</small>`, `<details><summary>Открыть</summary><pre>${e(JSON.stringify(item.details ?? {}, null, 2))}</pre></details>`]));
    default: return '';
  }
}
async function referenceOptions(section) {
  const resources = section === 'subscriptions' ? ['users', 'products', 'plans'] : section === 'plans' ? ['products'] : [];
  const results = await Promise.all(resources.map((resource) => api.adminList(resource, { pageSize: 100 })));
  return resources.map((resource, index) => `<datalist id="${resource.slice(0, -1)}-options">${results[index].items.map((item) => `<option value="${e(item.id)}">${e(item.name || `${item.username} (${item.email})`)}${item.product?.name ? ` — ${e(item.product.name)}` : ''}</option>`).join('')}</datalist>`).join('');
}
export async function adminView(section = 'dashboard') {
  if (!sections[section]) throw new api.ApiError('Раздел не найден.', 404);
  const prefix = `${heading('Админ-панель', 'Управление продуктами, пользователями и подписками.')}${nav(section)}`;
  if (section === 'dashboard') {
    const data = await api.getAdminDashboard();
    const stats = [['Пользователи', data.users], ['Активные подписки', data.activeSubscriptions], ['Заказы', data.orders], ['Оплаченные заказы', data.paidOrders], ['Сумма оплаченных заказов', money(data.totalRevenue)]];
    return { title: 'Админ-панель', html: `${prefix}<h2>Обзор</h2><div class="stats">${stats.map(([label, value]) => `<article class="panel"><span>${e(label)}</span><strong>${e(value)}</strong></article>`).join('')}</div>` };
  }
  const params = new URLSearchParams(location.search);
  const filters = { page: Number(params.get('page')) || 1, pageSize: 20, ...(section === 'users' && params.get('search') ? { search: params.get('search') } : {}), ...(section === 'orders' && params.get('status') ? { status: params.get('status') } : {}) };
  const [result, options] = await Promise.all([api.adminList(section, filters), referenceOptions(section)]);
  let selected = null;
  const filterForm = section === 'users' ? `<form id="filter-form" class="filters">${field('search', 'Поиск по логину или email', { value: params.get('search') || '', required: false, type: 'search', maxLength: 160 })}<button>Найти</button></form>` : section === 'orders' ? `<form id="filter-form" class="filters">${selectField('status', 'Статус заказа', [['', 'Все статусы'], ['pending', 'Ожидает оплаты'], ['paid', 'Оплачен'], ['cancelled', 'Отменён'], ['refunded', 'Возврат']], params.get('status') || '')}<button>Применить</button></form>` : '';
  return {
    title: `${sections[section]} — Админ-панель`,
    html: `${prefix}<div class="section-heading"><h2>${sections[section]}</h2>${editable.includes(section) ? '<button id="new-record">Добавить</button>' : ''}</div>${filterForm}<div id="admin-feedback" role="status" aria-live="polite"></div>${editable.includes(section) ? `<section id="editor" class="panel" hidden><h3 id="editor-title">Новая запись</h3><form id="editor-form" class="stack"><div id="editor-fields" class="form-grid"></div>${options}${formStatus()}<div class="actions"><button type="submit">Сохранить</button><button type="button" class="secondary" id="close-editor">Отмена</button></div></form></section>` : ''}${getTable(section, result.items)}${pagination(result, location.href)}`,
    bind(root) {
      const feedback = root.querySelector('#admin-feedback');
      const editor = root.querySelector('#editor');
      const editorForm = root.querySelector('#editor-form');
      const openEditor = (item = null) => {
        selected = item;
        root.querySelector('#editor-title').textContent = item ? 'Редактирование записи' : 'Новая запись';
        root.querySelector('#editor-fields').innerHTML = editorFields(section, item || {});
        report(editorForm, '');
        editor.hidden = false;
        editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
        editor.querySelector('input, select, textarea')?.focus({ preventScroll: true });
      };
      root.querySelector('#new-record')?.addEventListener('click', () => openEditor());
      root.querySelector('#close-editor')?.addEventListener('click', () => { editor.hidden = true; selected = null; });
      if (editorForm) bindForm(editorForm, async (values, form) => {
        const body = editorPayload(section, values, form, Boolean(selected));
        if (selected) await api.adminUpdate(section, selected.id, body);
        else await api.adminCreate(section, body);
        navigate(`${location.pathname}${location.search}`, { replace: true });
      });
      root.querySelector('#filter-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const values = new URLSearchParams(new FormData(event.currentTarget));
        navigate(`/admin/${section}?${values}`);
      });
      root.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => {
        const item = result.items.find((record) => record.id === button.dataset.id);
        if (!item) return;
        const action = button.dataset.action;
        if (action === 'edit') { openEditor(item); return; }
        button.disabled = true;
        feedback.textContent = 'Подождите…';
        try {
          if (action === 'block') await api.adminUpdate('users', item.id, { isBlocked: !item.isBlocked });
          else if (action === 'role') await api.adminUpdate('users', item.id, { role: item.role === 'admin' ? 'user' : 'admin' });
          else if (action === 'deactivate') await api.adminDelete('products', item.id);
          else if (action === 'cancel') await api.adminUpdate('subscriptions', item.id, { status: 'cancelled' });
          navigate(`${location.pathname}${location.search}`, { replace: true });
        } catch (error) { feedback.textContent = error.message; feedback.className = 'notice error'; button.disabled = false; }
      }));
    },
  };
}
