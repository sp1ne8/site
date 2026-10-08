import * as api from '../api.js';
import { bindForm, date, escapeHtml as e, field, formStatus, heading, notice, report, table } from '../ui.js';
import { jurisdictionSelect, legalNotice, documentLink, refreshPrivacy } from '../privacy.js';
import { DOCUMENTS, JURISDICTIONS } from '../../../shared/legal.js';
import { navigate } from '../router.js';
export function documentBody(text) {
  return text.split(/\n+/).filter(Boolean).map(line => line.startsWith('## ') ? `<h2>${e(line.slice(3))}</h2>` : `<p>${e(line)}</p>`).join('');
}
const checkbox = (name, label, required = false, disabled = false) => `<label class="legal-checkbox"><input type="checkbox" name="${name}"${required ? ' required' : ''}${disabled ? ' disabled' : ''}><span>${label}</span></label>`;
export function accountLegalFields(config, { register = true } = {}) {
  return `${legalNotice(config)}<div class="legal-checkboxes">${checkbox('policyAcknowledged', `Я ознакомился с ${documentLink('personal-data-policy', 'Политикой обработки персональных данных', config)}`, true)}${register ? checkbox('termsAccepted', `Я принимаю ${documentLink('terms', 'Условия использования', config)}`, true) : ''}${config.settings.accountBasis === 'consent' ? checkbox('privacyConsent', `Я даю отдельное ${documentLink('user-consent', 'согласие на обработку данных аккаунта', config)}`, true) : ''}${register ? checkbox('marketingConsent', `Я согласен получать рекламные/маркетинговые сообщения. ${documentLink('marketing-consent', 'Отдельные условия', config)}<small>Рассылки пока не подключены; согласие не собирается и не влияет на регистрацию.</small>`, false, true) : ''}</div>`;
}
export function accountLegalPayload(form, config, register = true) {
  const documentId = kind => config.documents.find(item => item.kind === kind)?.id;
  return { jurisdiction: config.jurisdiction, policyAcknowledged: form.elements.policyAcknowledged.checked, policyDocumentId: documentId('personal-data-policy'), ...(register ? { termsAccepted: form.elements.termsAccepted.checked, termsDocumentId: documentId('terms'), marketingConsent: false } : {}), privacyConsent: Boolean(form.elements.privacyConsent?.checked), ...(config.settings.accountBasis === 'consent' ? { consentDocumentId: documentId('user-consent') } : {}) };
}
export async function legalView(kind) {
  const params = new URLSearchParams(location.search);
  const code = Object.hasOwn(JURISDICTIONS, params.get('jurisdiction')) ? params.get('jurisdiction') : 'RU';
  const config = await api.getLegalConfig(code);
  const document = params.get('document') ? await api.getLegalDocument(params.get('document')) : config.documents.find(item => item.kind === kind);
  if (!document || document.kind !== kind || document.jurisdiction !== code) throw new api.ApiError('Документ не найден для выбранной страны.', 404);
  const cookies = kind === 'cookie-policy' ? `<section><h2>Актуальный реестр cookies и browser storage</h2>${table(['Имя', 'Цель', 'Поставщик', 'Категория', 'Срок', 'Сторона', 'Необходимость'], [...config.inventory.cookies, ...config.inventory.storage].map(item => [e(item.name), e(item.purpose), e(item.provider), e(item.type), e(item.duration), e(item.party), item.required ? 'Необходимая' : 'Необязательная']))}<p class="muted">${e(config.inventory.externalCookies)}</p><button type="button" class="secondary" data-cookie-settings>Cookie Settings</button></section>` : '';
  return { title: DOCUMENTS[kind], html: `<div class="legal-page">${heading(DOCUMENTS[kind])}<div class="legal-toolbar">${jurisdictionSelect(code)}<div class="legal-version"><span>${e(document.version)}</span><span>${e(date(document.publishedAt || document.createdAt))}</span><span class="badge">${e(document.status === 'draft' ? 'Проект' : document.status === 'archived' ? 'Архивная версия' : 'Опубликовано')}</span></div></div>${legalNotice(config)}<div class="legal-layout"><aside><nav aria-label="Юридические документы">${Object.entries(DOCUMENTS).map(([key, title]) => `<a data-link href="/${key}?jurisdiction=${code}"${key === kind ? ' aria-current="page"' : ''}>${e(title)}</a>`).join('')}</nav></aside><article class="panel legal-document">${documentBody(document.body)}<section class="legal-country-settings"><h2>Настройки ${e(config.label)}</h2><p>${e(config.settings.notice)}</p><p>${e(config.settings.withdrawal)}</p><p>${e(config.settings.requestProcedure)}</p>${kind === 'refund-policy' ? `<p>${e(config.settings.refundRules)}</p>` : kind === 'offer' ? `<p>${e(config.settings.paymentTerms)}</p>` : ''}</section>${cookies}</article></div></div>`, bind(root) { root.querySelector('[name="jurisdiction"]').addEventListener('change', event => navigate(`/${kind}?jurisdiction=${event.target.value}`)); } };
}
export async function privacyView(state) {
  const data = await api.getPrivacyOverview();
  let config = await api.getLegalConfig(data.user.jurisdiction || 'RU');
  const latestPrivacy = data.consents.find(item => item.type === 'privacy' && item.basis === 'consent');
  const needsAcknowledgement = !data.user.jurisdiction || data.user.privacyRestricted || (config.settings.accountBasis === 'consent' && (latestPrivacy?.status !== 'granted' || latestPrivacy?.documentId !== config.documents.find(item => item.kind === 'user-consent').id || latestPrivacy?.policyRevision !== config.revision));
  return {
    title: 'Privacy & Data',
    html: `<div class="workspace-page privacy-page">${heading('Privacy & Data', 'Ваши данные, согласия и обращения.')}<div class="privacy-overview"><section class="panel workspace-panel"><h2>Основные данные</h2><dl class="privacy-data"><div><dt>Email</dt><dd>${e(data.user.email)}</dd></div><div><dt>Логин</dt><dd>${e(data.user.username)}</dd></div><div><dt>Аккаунт</dt><dd><code>${e(data.user.id)}</code></dd></div><div><dt>Регистрация</dt><dd>${e(date(data.user.createdAt))}</dd></div><div><dt>Юрисдикция</dt><dd>${e(JURISDICTIONS[data.user.jurisdiction] || 'Не выбрана')}</dd></div><div><dt>Активные сеансы</dt><dd>${data.sessions.length}</dd></div></dl><div class="actions"><a data-link class="button secondary" href="/profile">Исправить профиль</a><button type="button" class="secondary" id="download-data">Скачать основные данные</button></div><p id="privacy-feedback" role="status" aria-live="polite"></p></section><section class="panel workspace-panel"><h2>Согласия и настройки</h2><p>Отказ от необязательных технологий сохраняет основные функции аккаунта. Аналитика и рассылки не подключены.</p><div class="actions"><button type="button" data-cookie-settings>Cookie Settings</button><button type="button" class="secondary" data-withdraw="marketing">Отозвать маркетинговое согласие</button>${config.settings.accountBasis === 'consent' && latestPrivacy?.status === 'granted' ? '<button type="button" class="secondary" data-withdraw="privacy">Отозвать согласие аккаунта</button>' : ''}</div>${config.settings.accountBasis === 'consent' ? '<p class="muted">После отзыва согласия аккаунта новые покупки приостанавливаются, а оператор рассматривает прекращение обработки и другие применимые основания. Кабинет прав остаётся доступен.</p>' : '<p class="muted">Основная договорная обработка не подменяется отзывным согласием. Для прекращения обслуживания направьте запрос.</p>'}<div class="text-links">${Object.entries(DOCUMENTS).map(([kind, label]) => documentLink(kind, label, config)).join('')}</div></section></div>${needsAcknowledgement ? `<section class="panel workspace-panel"><h2>Юридическая конфигурация аккаунта</h2><form id="account-legal-form" class="stack">${data.user.jurisdiction ? `<p>${e(config.label)}</p>` : jurisdictionSelect(config.jurisdiction)}<div id="account-legal-fields">${accountLegalFields(config, { register: false })}</div>${formStatus()}<button>Подтвердить выбор</button></form></section>` : ''}<section class="workspace-section"><h2>История решений</h2>${table(['Тип', 'Решение', 'Основание', 'Дата', 'Версия', 'Подтверждение'], data.consents.map(item => [e(item.type), e(item.status), e(item.basis), e(date(item.createdAt)), `<a data-link href="/${e(item.document?.kind || 'cookie-policy')}?jurisdiction=${e(item.jurisdiction)}&document=${e(item.documentId)}">${e(item.documentVersion)}</a>`, `<code>${e(item.receiptId)}</code>`]))}</section><section class="panel workspace-panel"><h2>Запрос о данных</h2><p>Удаление рассматривается отдельно от обязательного учёта. Не указывайте платёжные секреты или документы, которые не нужны для запроса.</p><form id="data-request-form" class="stack"><label>Тип обращения<select name="type"><option value="export">Получение сведений / данных</option><option value="correction">Исправление данных</option><option value="deletion">Удаление / закрытие аккаунта</option><option value="withdrawal">Прекращение обработки</option><option value="other">Другое</option></select></label><label>Описание<textarea name="message" rows="4" maxlength="4000"></textarea></label><div id="deletion-password" hidden>${field('currentPassword', 'Текущий пароль — подтверждение запроса удаления', { type: 'password', required: false, autocomplete: 'current-password', maxLength: 72 })}</div>${formStatus()}<button>Отправить запрос</button></form><p class="muted">${e(config.settings.requestProcedure)}</p><p class="muted">Обращение вне кабинета: ${e(config.settings.operator.email)}. Для заблокированных/закрытых аккаунтов используйте контакт оператора.</p></section><section class="workspace-section"><h2>Ваши обращения</h2>${data.requests.map(item => `<article class="panel privacy-request"><div><strong>${e(item.type)}</strong><span class="badge">${e(item.status)}</span><code>${e(item.id)}</code></div><p>${e(item.message || 'Без дополнительного описания')}</p><small>${e(date(item.createdAt))}${item.dueAt ? ` · Срок ответа: ${e(date(item.dueAt))}` : ' · Срок требует настройки оператором'}</small>${item.response ? `<p class="preserve-lines privacy-request__response">${e(item.response)}</p>` : ''}</article>`).join('') || '<p class="empty">Обращений пока нет.</p>'}</section></div>`,
    bind(root) {
      const feedback = root.querySelector('#privacy-feedback');
      root.querySelector('#download-data').addEventListener('click', async event => {
        const button = event.currentTarget; button.disabled = true;
        try { const exported = await api.exportPrivacyData(); const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `hydra-data-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); feedback.textContent = 'Основные данные аккаунта выгружены. Для дополнительных сведений используйте форму обращения.'; }
        catch (error) { feedback.textContent = error.message; } finally { button.disabled = false; }
      });
      root.querySelectorAll('[data-withdraw]').forEach(button => button.addEventListener('click', async () => {
        button.disabled = true;
        try { await api.withdrawPrivacyConsent(button.dataset.withdraw); await refreshPrivacy(state.user); navigate('/privacy-data', { replace: true }); }
        catch (error) { feedback.textContent = error.message; button.disabled = false; }
      }));
      const requestForm = root.querySelector('#data-request-form');
      requestForm.elements.type.addEventListener('change', () => { const deletion = requestForm.elements.type.value === 'deletion'; root.querySelector('#deletion-password').hidden = !deletion; requestForm.elements.currentPassword.required = deletion; if (!deletion) requestForm.elements.currentPassword.value = ''; });
      bindForm(requestForm, async (values) => { await api.createPrivacyRequest({ type: values.type, message: values.message, ...(values.type === 'deletion' ? { currentPassword: values.currentPassword } : {}) }); navigate('/privacy-data', { replace: true }); });
      const legalForm = root.querySelector('#account-legal-form');
      if (legalForm) {
        const submit = legalForm.querySelector('button[type="submit"], button:not([type])');
        let sequence = 0;
        legalForm.querySelector('select[name="jurisdiction"]')?.addEventListener('change', async event => {
          const request = ++sequence; submit.disabled = true;
          try {
            const next = await api.getLegalConfig(event.target.value);
            if (request !== sequence || !legalForm.isConnected) return;
            config = next; root.querySelector('#account-legal-fields').innerHTML = accountLegalFields(config, { register: false }); submit.disabled = false;
          }
          catch (error) { if (request === sequence && legalForm.isConnected) report(legalForm, error.message, true); }
        });
        bindForm(legalForm, async (_values, form) => { state.user = await api.confirmPrivacyPolicy(accountLegalPayload(form, config, false)); navigate('/privacy-data', { replace: true }); });
      }
    },
  };
}
