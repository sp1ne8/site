import * as api from '../api.js';
import { bindForm, date, escapeHtml as e, field, formStatus, heading, localDateTime, pagination, report, table } from '../ui.js';
import { JURISDICTIONS, DOCUMENTS } from '../../../shared/legal.js';
import { navigate } from '../router.js';
import { scrollToSection } from '../motion.js';
const resources = { documents: 'Documents', consents: 'Consents', cookies: 'Cookies', requests: 'Data Requests', logs: 'Audit Logs', jurisdictions: 'Jurisdictions', holds: 'Сохраняемые записи' };
const select = (name, label, options, value) => `<label>${e(label)}<select name="${e(name)}">${Object.entries(options).map(([key, title]) => `<option value="${e(key)}"${key === value ? ' selected' : ''}>${e(title)}</option>`).join('')}</select></label>`;
const area = (name, label, value, rows = 5, required = true) => `<label>${e(label)}<textarea name="${e(name)}" rows="${rows}" maxlength="50000"${required ? ' required' : ''}>${e(value || '')}</textarea></label>`;
const button = (action, id, label) => `<button type="button" class="secondary compact" data-legal-action="${action}" data-id="${e(id)}">${e(label)}</button>`;
function dataTable(resource, items) {
  if (resource === 'documents') return table(['Документ', 'Страна', 'Версия / дата', 'Статус', 'Действия'], items.map(item => [e(item.title), e(item.jurisdiction), `${e(item.version)}<small>${e(date(item.publishedAt || item.createdAt))}</small>`, e(item.status), `${button('copy', item.id, 'Новая версия')}${button('history', item.id, 'История')}${item.status === 'draft' && !item._count.consentEvents ? button('edit-document', item.id, 'Редактировать') : `<a data-link href="/${e(item.kind)}?jurisdiction=${e(item.jurisdiction)}&document=${e(item.id)}">Открыть</a>`}`]));
  if (resource === 'consents') return table(['Пользователь', 'Тип / основание', 'Статус', 'Дата', 'Версия', 'Подтверждение'], items.map(item => [item.user ? `${e(item.user.username)}<small>${e(item.user.email)}</small>` : 'Anonymous (hash хранится на сервере)', `${e(item.type)}<small>${e(item.basis)} · ${e(item.jurisdiction)}</small>`, e(item.status), e(date(item.createdAt)), e(item.documentVersion), `<code>${e(item.receiptId)}</code>`]));
  if (resource === 'requests') return table(['Пользователь', 'Запрос', 'Страна', 'Статус', 'Срок', 'Действие'], items.map(item => [e(item.user.username), `${e(item.type)}<small>${e(item.message.slice(0, 100))}</small>`, e(item.jurisdiction), e(item.status), item.dueAt ? e(date(item.dueAt)) : 'Не настроен', button('request', item.id, 'Рассмотреть')]));
  if (resource === 'jurisdictions') return table(['Страна', 'Статус', 'Модель аккаунта', 'Версия', 'Действие'], items.map(item => [e(JURISDICTIONS[item.code]), item.code === 'OTHER_CIS' ? 'JURISDICTION_NOT_CONFIGURED' : item.enabled ? 'Настроена' : 'NEEDS CONFIGURATION', e(item.settings.accountBasis), item.revision, button('jurisdiction', item.code, 'Настроить')]));
  if (resource === 'holds') return table(['Пользователь', 'Категории', 'Основание', 'Проверка хранения'], items.map(item => [e(item.user.username), e(item.categories.join(', ')), e(item.basis), e(date(item.reviewAt))]));
  return table(['Дата', 'Действие', 'Объект', 'ID', 'Технические сведения'], items.map(item => [e(date(item.createdAt)), e(item.action), e(item.entity), `<code>${e(item.entityId || '—')}</code>`, `<code>${e(JSON.stringify(item.details || {}))}</code>`]));
}
function policyFields(policy) {
  const settings = policy.settings;
  const externalOrigins = field('externalMediaOrigins', 'Проверенные внешние медиа — HTTPS origins через запятую', { value: (settings.externalMediaOrigins || []).join(', '), required: false, maxLength: 10000, help: 'Для production загрузка отключена, пока все источники каталога не проверены и не включены сюда. Например: https://media.example.test' });
  const group = (name, title, labels) => `<details><summary>${title}</summary><div class="form-grid">${Object.entries(labels).map(([key, label]) => field(`${name}.${key}`, label, { value: settings[name][key], maxLength: 10000 })).join('')}</div></details>`;
  return `${externalOrigins}${select('accountBasis', 'Основание основной обработки аккаунта', { contract: 'Договор / проверенное исключение', consent: 'Отдельное согласие' }, settings.accountBasis)}${select('confirmationMethod', 'Подтверждение согласия', { checkbox: 'Checkbox + серверная квитанция', 'external-verification': 'Внешний сервис — адаптер ещё не подключён' }, settings.confirmationMethod)}${group('operator', 'Реквизиты оператора', { company: 'Компания / продавец', name: 'Оператор', registration: 'ИНН / БИН / регистрационный номер', address: 'Адрес', email: 'Email', phone: 'Телефон', country: 'Страна регистрации' })}${group('infrastructure', 'Размещение и провайдеры', { backend: 'Backend — страна', database: 'База данных — страна', backups: 'Backup — страна', email: 'Email-провайдер / страна', payment: 'Платёжный провайдер / страна', cdn: 'CDN / страна либо не используется' })}${group('retention', 'Сроки и основания хранения', { account: 'Аккаунт', financial: 'Заказы / платежи / учёт', consents: 'Согласия', requests: 'Обращения', logs: 'Журналы', backups: 'Резервные копии' })}<div class="form-grid">${field('requestDays', 'Срок обработки запроса, календарных дней', { type: 'number', min: 1, max: 365, required: false, value: settings.requestDays || '', help: 'Не заменяет разные обязательные сроки закона. Пусто — не настроено; для иных сроков оператор назначает дату запросу вручную.' })}${field('retention.consentsDays', 'Очистка истории согласий, дней', { type: 'number', min: 1, max: 36500, required: false, value: settings.retention.consentsDays || '' })}${field('retention.requestsDays', 'Хранение завершённых запросов, дней', { type: 'number', min: 1, max: 36500, required: false, value: settings.retention.requestsDays || '' })}</div>${area('notice', 'Уведомление страны', settings.notice)}${area('withdrawal', 'Порядок отзыва', settings.withdrawal)}${area('requestProcedure', 'Обращения, формы и сроки по категориям', settings.requestProcedure)}${area('transfers', 'Трансграничные передачи и получатели', settings.transfers)}${area('paymentTerms', 'Платёжные условия', settings.paymentTerms)}${area('refundRules', 'Правила возврата', settings.refundRules)}${field('reviewedBy', 'Ответственный за юридическую проверку', { value: settings.reviewedBy, required: false, maxLength: 500 })}${field('reviewedAt', 'Дата проверки', { type: 'datetime-local', value: localDateTime(settings.reviewedAt), required: false })}<label class="legal-checkbox"><input type="checkbox" name="enabled"${policy.enabled ? ' checked' : ''}><span>Включить проверенную конфигурацию. Необходимы реальные реквизиты и все опубликованные основные документы.</span></label>`;
}
function settingsPayload(values, form, policy) {
  const settings = structuredClone(policy.settings);
  for (const [path, value] of Object.entries(values)) {
    if (path === 'enabled') continue;
    if (path === 'externalMediaOrigins') { settings.externalMediaOrigins = value.split(/[\s,]+/).filter(Boolean).map(origin => new URL(origin).origin); continue; }
    const parts = path.split('.'); const key = parts.pop(); const target = parts.length ? settings[parts[0]] : settings;
    target[key] = path.endsWith('Days') ? (value ? Number(value) : null) : path === 'reviewedAt' ? (value ? new Date(value).toISOString() : null) : value;
  }
  return { revision: policy.revision, enabled: form.elements.enabled.checked, settings };
}
export async function legalAdminView(prefix) {
  const params = new URLSearchParams(location.search);
  const resource = Object.hasOwn(resources, params.get('tab')) ? params.get('tab') : 'documents';
  const filters = { page: Number(params.get('page')) || 1, pageSize: 20, ...(params.get('jurisdiction') && Object.hasOwn(JURISDICTIONS, params.get('jurisdiction')) ? { jurisdiction: params.get('jurisdiction') } : {}) };
  const result = await api.getLegalAdmin(resource, filters);
  let selected;
  let editorMode;
  const cookies = resource === 'cookies' ? `${table(['Cookie / storage', 'Назначение', 'Тип', 'Срок', 'Сторона'], [...result.cookies, ...result.storage].map(item => [e(item.name), e(item.purpose), e(item.type), e(item.duration), e(item.party)]))}<p>Неактивные категории: ${e(result.inactiveCategories.join(', '))}</p><p class="preserve-lines">Внешние источники: ${e(result.externalMediaHosts.join('\n') || 'Нет')}</p><p>${e(result.externalCookies)}</p>` : dataTable(resource, result.items);
  return {
    title: 'Legal / Privacy — Админ-панель',
    html: `<div class="admin-page">${prefix}${heading('Legal / Privacy', 'Документы, раздельные согласия, обращения и конфигурации стран.')}<nav class="tabs" aria-label="Legal / Privacy">${Object.entries(resources).map(([key, title]) => `<a data-link href="/admin/legal?tab=${key}"${key === resource ? ' aria-current="page"' : ''}>${title}</a>`).join('')}</nav><form id="legal-filter" class="filters">${select('jurisdiction', 'Юрисдикция', { '': 'Все страны', ...JURISDICTIONS }, filters.jurisdiction || '')}<button>Применить</button></form><p class="notice">Публикация требует заполнения и юридической проверки. Опубликованные версии и решения пользователей не редактируются. Для запросов удаления используется закрытие аккаунта с отдельным учётом сохраняемых записей.</p>${resource === 'documents' ? '<button type="button" id="new-document">Новый документ</button>' : ''}<p id="legal-feedback" role="status" aria-live="polite"></p><section id="legal-editor" class="panel legal-admin-editor" hidden><h2 id="legal-editor-title"></h2><form id="legal-editor-form" class="stack"><div id="legal-editor-fields" class="stack"></div>${formStatus()}<div class="actions"><button type="submit">Сохранить</button><button type="button" class="secondary" id="legal-editor-close">Закрыть</button></div></form></section><div class="admin-data">${cookies}</div>${resource === 'cookies' ? '' : pagination(result, location.href)}</div>`,
    bind(root) {
      const editor = root.querySelector('#legal-editor'); const form = root.querySelector('#legal-editor-form'); const fields = root.querySelector('#legal-editor-fields'); const feedback = root.querySelector('#legal-feedback');
      const open = (mode, item) => {
        form.querySelector('button[type="submit"]').hidden = false;
        selected = item; editorMode = mode;
        root.querySelector('#legal-editor-title').textContent = mode === 'jurisdiction' ? `Настройки ${JURISDICTIONS[item.code]}` : mode === 'request' ? 'Рассмотрение запроса' : mode === 'edit-document' ? 'Редактирование проекта' : 'Новая версия документа';
        if (mode === 'jurisdiction') fields.innerHTML = policyFields(item);
        else if (mode === 'request') fields.innerHTML = `<p><strong>${e(item.type)}</strong> · ${e(item.status)} · ${e(item.user.username)}</p><p class="preserve-lines">${e(item.message)}</p>${area('response', 'Ответ пользователю', item.response, 6, false)}${select('status', 'Результат рассмотрения', { in_review: 'В рассмотрении', ...(item.type === 'deletion' ? {} : { fulfilled: 'Выполнен' }), rejected: 'Мотивированный отказ' }, item.status === 'pending' ? 'in_review' : item.status)}${field('dueAt', 'Срок ответа / ручное уточнение по закону', { type: 'datetime-local', value: localDateTime(item.dueAt), required: false })}${item.type === 'deletion' && ['pending', 'in_review'].includes(item.status) ? `<details><summary>Закрытие аккаунта после проверки запроса</summary><div class="stack"><p>Это прекращение доступа и псевдонимизация профиля; заказы, платежи и юридические доказательства сохраняются отдельно. Перед действием согласуйте обязательства и доступ пользователя к ответу.</p>${area('basis', 'Основание сохраняемых записей', '', 4, false)}${field('reviewAt', 'Конечная дата проверки / прекращения хранения', { type: 'datetime-local', required: false })}<label class="legal-checkbox"><input type="checkbox" name="reviewed"><span>Запрос и личность проверены; основания и сроки сохранения согласованы.</span></label><button type="button" class="danger" id="close-account">Закрыть аккаунт по запросу</button></div></details>` : ''}`;
        else fields.innerHTML = `${mode === 'edit-document' ? `<p>${e(item.jurisdiction)} · ${e(item.kind)} · ${e(item.version)}</p>` : `${select('jurisdiction', 'Страна', JURISDICTIONS, item?.jurisdiction || 'RU')}${select('kind', 'Документ', DOCUMENTS, item?.kind || 'privacy-policy')}${field('version', 'Уникальная версия', { value: `${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`, maxLength: 80 })}`}${field('title', 'Название', { value: item?.title || DOCUMENTS['privacy-policy'], maxLength: 200 })}${area('body', 'Текст (обычный текст; заголовки начинаются с ##)', item?.body, 22)}${mode === 'edit-document' ? '<label class="legal-checkbox"><input type="checkbox" name="legallyReviewed"><span>Текст и настройки страны проверены; реквизиты реальны.</span></label><button type="button" class="secondary" id="publish-document">Опубликовать сохранённую версию</button>' : ''}`;
        report(form, ''); editor.hidden = false; scrollToSection(editor); editor.querySelector('input,select,textarea')?.focus({ preventScroll: true });
        fields.querySelector('#publish-document')?.addEventListener('click', async event => {
          const publish = event.currentTarget; publish.disabled = true;
          try { if (!form.elements.legallyReviewed.checked) throw new Error('Отметьте подтверждение юридической проверки.'); await api.editLegalDocument(item.id, { title: form.elements.title.value, body: form.elements.body.value }); await api.publishLegalDocument(item.id); navigate(location.pathname + location.search, { replace: true }); }
          catch (error) { report(form, error.message, true); publish.disabled = false; }
        });
        fields.querySelector('#close-account')?.addEventListener('click', async event => {
          const close = event.currentTarget; close.disabled = true;
          try {
            if (!form.elements.reviewed.checked || !form.elements.reviewAt.value) throw new Error('Подтвердите проверку и укажите конечную дату хранения.');
            await api.closePrivacyAccount(item.id, { reviewed: true, response: form.elements.response.value, basis: form.elements.basis.value, reviewAt: new Date(form.elements.reviewAt.value).toISOString() }); navigate(location.pathname + location.search, { replace: true });
          } catch (error) { report(form, error.message, true); close.disabled = false; }
        });
      };
      root.querySelector('#new-document')?.addEventListener('click', () => open('new-document', null));
      root.querySelector('#legal-editor-close').addEventListener('click', () => { editor.hidden = true; });
      root.querySelectorAll('[data-legal-action]').forEach(control => control.addEventListener('click', async () => {
        const item = result.items.find(item => (item.id || item.code) === control.dataset.id);
        if (control.dataset.legalAction !== 'history') { open(control.dataset.legalAction, item); return; }
        try {
          const history = await api.getLegalDocumentHistory(item.id);
          root.querySelector('#legal-editor-title').textContent = `История: ${item.title}`;
          fields.innerHTML = history.map(entry => `<details><summary>${e(date(entry.createdAt))} · ${e(entry.action)}</summary>${entry.details?.before ? `<h3>До изменения</h3><pre class="preserve-lines">${e(entry.details.before.body)}</pre><h3>После изменения</h3><pre class="preserve-lines">${e(entry.details.after.body)}</pre>` : `<p>${e(JSON.stringify(entry.details || {}))}</p>`}</details>`).join('') || '<p>Изменений пока нет. Исходные проекты созданы автоматически; новые версии сохраняются отдельно.</p>';
          form.querySelector('button[type="submit"]').hidden = true; report(form, ''); editor.hidden = false; scrollToSection(editor);
        } catch (error) { feedback.textContent = error.message; }
      }));
      root.querySelector('#legal-filter').addEventListener('submit', event => { event.preventDefault(); const country = event.currentTarget.elements.jurisdiction.value; navigate(`/admin/legal?tab=${resource}${country ? `&jurisdiction=${country}` : ''}`); });
      bindForm(form, async values => {
        if (editorMode === 'jurisdiction') await api.updateJurisdiction(selected.code, settingsPayload(values, form, selected));
        else if (editorMode === 'request') await api.updateDataRequest(selected.id, { status: values.status, response: values.response, ...(values.dueAt ? { dueAt: new Date(values.dueAt).toISOString() } : {}) });
        else if (editorMode === 'edit-document') await api.editLegalDocument(selected.id, { title: values.title, body: values.body });
        else await api.createLegalDocument({ jurisdiction: values.jurisdiction, kind: values.kind, version: values.version, title: values.title, body: values.body });
        feedback.textContent = 'Сохранено.'; navigate(location.pathname + location.search, { replace: true });
      });
    },
  };
}
