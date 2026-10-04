export const escapeHtml = (value = '') => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const money = (value) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(Number(value ?? 0));
export const date = (value) => value ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const statusLabels = { pending: 'Ожидает оплаты', paid: 'Оплачен', cancelled: 'Отменён', refunded: 'Возврат', active: 'Активна', expired: 'Истекла', succeeded: 'Успешно' };
export const status = (value) => `<span class="badge">${escapeHtml(statusLabels[value] || value)}</span>`;
export const notice = (message, kind = '') => `<p class="notice ${kind}" role="status">${escapeHtml(message)}</p>`;
export const empty = (message) => `<p class="empty">${escapeHtml(message)}</p>`;
export const heading = (title, subtitle = '') => `<header class="page-heading"><h1>${escapeHtml(title)}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</header>`;
export const field = (name, label, options = {}) => {
  const { type = 'text', value = '', required = true, autocomplete, min, max, minLength, maxLength, pattern, help, step, readonly } = options;
  return `<label>${escapeHtml(label)}<input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}"${required ? ' required' : ''}${readonly ? ' readonly' : ''}${autocomplete ? ` autocomplete="${escapeHtml(autocomplete)}"` : ''}${min !== undefined ? ` min="${escapeHtml(min)}"` : ''}${max !== undefined ? ` max="${escapeHtml(max)}"` : ''}${minLength ? ` minlength="${minLength}"` : ''}${maxLength ? ` maxlength="${maxLength}"` : ''}${pattern ? ` pattern="${escapeHtml(pattern)}"` : ''}${step ? ` step="${escapeHtml(step)}"` : ''}>${help ? `<small>${escapeHtml(help)}</small>` : ''}</label>`;
};
export const formStatus = () => '<div class="form-status" role="status" aria-live="polite" tabindex="-1"></div>';
export function report(form, message, error = false) {
  const target = form.querySelector('.form-status');
  target.textContent = message;
  target.className = `form-status ${error ? 'error' : 'success'}`;
  if (error) target.focus();
}
export function bindForm(form, action) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity() || form.dataset.busy) return;
    const buttons = [...form.querySelectorAll('button')];
    form.dataset.busy = 'true';
    buttons.forEach((button) => { button.disabled = true; });
    report(form, 'Подождите…');
    try { await action(Object.fromEntries(new FormData(form)), form); }
    catch (error) { report(form, error.message || 'Не удалось выполнить действие.', true); }
    finally { delete form.dataset.busy; buttons.forEach((button) => { button.disabled = false; }); }
  });
}
export function table(headers, rows) {
  if (!rows.length) return empty('Записей пока нет.');
  return `<div class="table-scroll" tabindex="0" aria-label="Таблица с горизонтальной прокруткой"><table><thead><tr>${headers.map((item) => `<th scope="col">${escapeHtml(item)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
export function pagination(result, url) {
  const page = result.page || 1;
  const pages = Math.ceil(result.total / result.pageSize) || 1;
  if (pages <= 1) return '';
  const link = (next) => { const target = new URL(url, location.origin); target.searchParams.set('page', next); return `${target.pathname}${target.search}`; };
  return `<nav class="pagination" aria-label="Страницы списка">${page > 1 ? `<a data-link class="button secondary" href="${escapeHtml(link(page - 1))}">Назад</a>` : ''}<span>Страница ${page} из ${pages}</span>${page < pages ? `<a data-link class="button secondary" href="${escapeHtml(link(page + 1))}">Далее</a>` : ''}</nav>`;
}
export function safeHttpsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}
export function passwordMatch(values) {
  if (values.password !== values.confirmPassword) throw new Error('Пароли не совпадают.');
  if (new TextEncoder().encode(values.password).length > 20) throw new Error('Пароль должен занимать не более 20 символов');
}
export function localDateTime(value) {
  if (!value) return '';
  const instant = new Date(value);
  return new Date(instant.getTime() - instant.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
