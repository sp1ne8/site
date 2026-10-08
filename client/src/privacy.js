import * as api from './api.js';
import { escapeHtml as e } from './ui.js';
import { JURISDICTIONS } from '../../shared/legal.js';

let bundle;
let consent = { hasDecision: false, choices: { essential: true } };
let identity;
let dialog;
let returnFocus;
export const currentLegal = () => bundle;
export const jurisdictionSelect = (value = 'RU', name = 'jurisdiction') => `<label>Юридическая конфигурация<select name="${e(name)}">${Object.entries(JURISDICTIONS).map(([code, label]) => `<option value="${code}"${code === value ? ' selected' : ''}>${label}</option>`).join('')}</select><small>Выбор не определяет гражданство или применимое право автоматически.</small></label>`;
export function legalNotice(config) {
  if (config.status === 'JURISDICTION_NOT_CONFIGURED') return '<p class="notice error">JURISDICTION_NOT_CONFIGURED — отдельные правила страны ещё не настроены.</p>';
  return config.status === 'NEEDS_CONFIGURATION' ? '<p class="notice legal-draft-notice">Документы пока являются проектами. Реквизиты и правила страны требуют заполнения и проверки владельцем. Коммерческий запуск ещё не подготовлен.</p>' : '';
}
export function documentLink(kind, label, config = bundle) {
  return `<a data-link href="/${kind}?jurisdiction=${e(config?.jurisdiction || 'RU')}">${e(label)}</a>`;
}
export function mediaImage(url, fallback = '') {
  let target;
  try { target = new URL(url, location.origin); } catch { return fallback; }
  if (!['http:', 'https:'].includes(target.protocol)) return fallback;
  if (target.origin === location.origin) return `<img src="${e(target.href)}" alt="" loading="lazy">`;
  const allowed = consent.choices.thirdParty && bundle?.inventory.externalMediaHosts.includes(target.origin);
  return `<span class="private-media" data-private-media="${e(target.href)}">${allowed ? `<img src="${e(target.href)}" alt="" loading="lazy">` : '<button type="button" class="private-media__button" data-cookie-settings>Внешнее изображение<span>Разрешить загрузку →</span></button>'}</span>`;
}
function applyMedia() {
  document.querySelectorAll('[data-private-media]').forEach(element => {
    const target = new URL(element.dataset.privateMedia);
    const allowed = consent.choices.thirdParty && bundle?.inventory.externalMediaHosts.includes(target.origin);
    if (allowed && !element.querySelector('img')) element.innerHTML = `<img src="${e(target.href)}" alt="" loading="lazy">`;
    else if (!allowed && element.querySelector('img')) element.innerHTML = '<button type="button" class="private-media__button" data-cookie-settings>Внешнее изображение<span>Разрешить загрузку →</span></button>';
  });
}
export async function refreshPrivacy(user = null) {
  identity = user;
  consent = await api.getCookieConsents(user?.jurisdiction || undefined);
  bundle = await api.getLegalConfig(consent.jurisdiction);
  showBanner();
  applyMedia();
  window.dispatchEvent(new CustomEvent('hydra:privacy-change', { detail: consent.choices }));
}
async function choose(choices, status) {
  const document = bundle.documents.find(item => item.kind === 'cookie-policy');
  try {
    consent = await api.saveCookieConsents({ jurisdiction: bundle.jurisdiction, documentId: document.id, scopeVersion: bundle.inventory.scopeVersion, preferences: false, analytics: false, marketing: false, thirdParty: Boolean(choices.thirdParty) });
    showBanner(); applyMedia();
    window.dispatchEvent(new CustomEvent('hydra:privacy-change', { detail: consent.choices }));
    if (dialog?.open) dialog.close();
  } catch (error) { status.textContent = error.message; }
}
function showBanner() {
  const old = document.getElementById('cookie-banner');
  old?.remove();
  if (consent.hasDecision) return;
  const banner = document.createElement('aside');
  banner.id = 'cookie-banner'; banner.className = 'cookie-banner'; banner.setAttribute('aria-label', 'Cookies и приватность');
  banner.innerHTML = `<div><strong>Cookies и приватность</strong><p>Необходимые cookies поддерживают вход и безопасность. Необязательные технологии выключены до вашего выбора. ${documentLink('cookie-policy', 'Подробнее')}</p></div><div class="cookie-banner__actions"><button type="button" data-accept>Принять доступные</button><button type="button" class="secondary" data-reject>Отклонить необязательные</button><button type="button" class="text-button" data-cookie-settings>Настроить</button></div><p class="cookie-status" role="status" aria-live="polite"></p>`;
  document.body.append(banner);
  const status = banner.querySelector('.cookie-status');
  const decide = async accept => {
    const buttons = [...banner.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
    await choose({ thirdParty: accept && bundle.categories.thirdParty }, status);
    buttons.forEach(button => { button.disabled = false; });
  };
  banner.querySelector('[data-accept]').addEventListener('click', () => decide(true));
  banner.querySelector('[data-reject]').addEventListener('click', () => decide(false));
}
export function openCookieSettings() {
  if (!bundle) return;
  returnFocus = document.activeElement;
  dialog?.remove(); dialog = document.createElement('dialog'); dialog.className = 'cookie-dialog';
  dialog.setAttribute('aria-labelledby', 'cookie-dialog-title');
  const labels = { essential: ['Essential', 'Вход, безопасность и сохранение вашего решения.'], preferences: ['Preferences', 'Отдельные необязательные настройки не подключены.'], analytics: ['Analytics', 'Аналитика не подключена.'], marketing: ['Marketing', 'Рекламные cookies и SDK не подключены.'], thirdParty: ['Third-party', 'Внешние изображения каталога. Хост получит IP и технические HTTP-заголовки.'] };
  dialog.innerHTML = `<div class="cookie-dialog__heading"><h2 id="cookie-dialog-title">Настройки cookies</h2><button type="button" class="secondary compact" data-close aria-label="Закрыть настройки">✕</button></div><form class="stack" id="cookie-form">${identity?.jurisdiction ? `<p class="muted">${e(JURISDICTIONS[bundle.jurisdiction])}</p>` : jurisdictionSelect(bundle.jurisdiction)}${legalNotice(bundle)}<div class="cookie-categories">${Object.entries(labels).map(([key, [label, text]]) => `<label class="cookie-category"><span><strong>${label}</strong><small>${text}</small></span><input type="checkbox" name="${key}"${consent.choices[key] ? ' checked' : ''}${key === 'essential' || !bundle.categories[key] ? ' disabled' : ''}></label>`).join('')}</div>${bundle.inventory.externalMediaHosts.length ? `<div class="cookie-hosts"><strong>Внешние источники</strong>${bundle.inventory.externalMediaHosts.map(host => `<code>${e(host)}</code>`).join('')}<p>Страны, cookies и сроки хранения получателей требуют проверки владельцем.</p></div>` : ''}<p>${documentLink('cookie-policy', 'Политика cookies')}</p><p class="cookie-status" role="status" aria-live="polite"></p><div class="actions"><button type="submit">Сохранить выбор</button><button type="button" class="secondary" data-reject>Только необходимые</button></div></form>`;
  document.body.append(dialog); dialog.showModal();
  dialog.addEventListener('close', () => { if (returnFocus?.isConnected) returnFocus.focus(); });
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('select[name="jurisdiction"]')?.addEventListener('change', async event => {
    const selected = event.target.value;
    try { bundle = await api.getLegalConfig(selected); consent = await api.getCookieConsents(selected); dialog.close(); openCookieSettings(); }
    catch (error) { dialog.querySelector('.cookie-status').textContent = error.message; }
  });
  const decide = async values => {
    const form = dialog.querySelector('form'); const buttons = [...form.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
    await choose(values, form.querySelector('.cookie-status')); buttons.forEach(button => { button.disabled = false; });
  };
  dialog.querySelector('form').addEventListener('submit', event => { event.preventDefault(); decide({ thirdParty: event.currentTarget.elements.thirdParty.checked }); });
  dialog.querySelector('[data-reject]').addEventListener('click', () => decide({ thirdParty: false }));
}
document.addEventListener('click', event => {
  if (event.target.closest('[data-cookie-settings]')) { event.preventDefault(); openCookieSettings(); }
  if (event.target.closest('[data-link]') && dialog?.open) dialog.close();
});
// Optional SDK adapters must use this boundary and supply a cleanup function.
// No analytics/marketing SDK is registered in the current build.
export function optionalTechnology(category, start) {
  let stop;
  const update = () => {
    if (bundle?.categories[category] && consent.choices[category] && !stop) stop = start() || (() => {});
    else if ((!bundle?.categories[category] || !consent.choices[category]) && stop) { stop(); stop = null; }
  };
  update(); window.addEventListener('hydra:privacy-change', update);
  return () => { stop?.(); window.removeEventListener('hydra:privacy-change', update); };
}
