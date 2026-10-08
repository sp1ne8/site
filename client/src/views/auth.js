import * as api from '../api.js';
import { bindForm, escapeHtml as e, field, formStatus, heading, notice, passwordMatch, report } from '../ui.js';
import { navigate } from '../router.js';
import { currentLegal, jurisdictionSelect } from '../privacy.js';
import { accountLegalFields, accountLegalPayload } from './legal.js';

const passwordFields = () => field('password', 'Новый пароль', { type: 'password', autocomplete: 'new-password', minLength: 10, maxLength: 72, help: 'Минимум 10 символов, максимум 72 байта UTF-8.' }) + field('confirmPassword', 'Повторите пароль', { type: 'password', autocomplete: 'new-password', minLength: 10, maxLength: 72 });
export const usernameField = (value = '') => field('username', 'Логин', { value, autocomplete: 'username', minLength: 3, maxLength: 32, pattern: '[A-Za-z0-9_]{3,32}', help: '3–32 латинские буквы, цифры или знак _.' });

export async function authView(mode, state) {
  let legalConfig = mode === 'register' ? await api.getLegalConfig(currentLegal()?.jurisdiction || 'RU') : null;
  const params = new URLSearchParams(location.search);
  const configs = {
    login: { title: 'Вход', text: 'Откройте личный кабинет и управляйте подписками.', fields: field('email', 'Email', { type: 'email', autocomplete: 'email' }) + field('password', 'Пароль', { type: 'password', autocomplete: 'current-password', maxLength: 72 }), button: 'Войти' },
    register: { title: 'Регистрация', text: 'Создайте аккаунт для покупки цифровых продуктов.', fields: usernameField() + field('email', 'Email', { type: 'email', autocomplete: 'email' }) + passwordFields(), button: 'Создать аккаунт' },
    'forgot-password': { title: 'Восстановление пароля', text: 'Если аккаунт существует, мы отправим письмо со ссылкой для смены пароля.', fields: field('email', 'Email', { type: 'email', autocomplete: 'email' }), button: 'Отправить ссылку' },
    'reset-password': { title: 'Новый пароль', text: 'После смены пароля войдите в аккаунт заново.', fields: passwordFields(), button: 'Сохранить пароль' },
  };
  const config = configs[mode];
  const nextParam = params.get('next') || '/dashboard';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') && !nextParam.startsWith('/login') ? nextParam : '/dashboard';
  const missingToken = mode === 'reset-password' && !params.get('token');
  return {
    title: config.title,
    html: `<section class="auth-screen"><div class="auth-screen__art" aria-hidden="true"><div class="auth-screen__orbit"></div><img class="auth-screen__mark" src="/logo-1.png" alt=""><div class="auth-screen__coordinates"><span></span><span></span><span></span></div></div><div class="auth-screen__content">${heading(config.title, config.text)}${params.get('changed') ? notice('Пароль изменён. Войдите с новым паролем.') : ''}${missingToken ? notice('В ссылке отсутствует токен восстановления. Запросите новую ссылку.', 'error') : `<form id="auth-form" class="stack auth-form">${config.fields}${mode === 'register' ? `${jurisdictionSelect(legalConfig.jurisdiction)}<div id="register-legal-fields">${accountLegalFields(legalConfig)}</div>` : ''}${formStatus()}<button type="submit">${config.button}</button></form>`}<p class="text-links auth-screen__links"><a data-link href="/login">Вход</a><a data-link href="/register">Регистрация</a><a data-link href="/forgot-password">Забыли пароль?</a></p></div></section>`,
    bind(root) {
      if (missingToken) return;
      const authForm = root.querySelector('#auth-form');
      let countryRequest = 0;
      authForm.querySelector('[name="jurisdiction"]')?.addEventListener('change', async event => {
        const request = ++countryRequest;
        const selected = event.target.value;
        authForm.querySelector('button[type="submit"]').disabled = true;
        try {
          const result = await api.getLegalConfig(selected);
          if (request !== countryRequest) return;
          legalConfig = result;
          root.querySelector('#register-legal-fields').innerHTML = accountLegalFields(legalConfig);
          report(authForm, '');
        } catch (error) { if (request === countryRequest) report(authForm, error.message, true); }
        finally { if (request === countryRequest) authForm.querySelector('button[type="submit"]').disabled = false; }
      });
      bindForm(root.querySelector('#auth-form'), async (values, form) => {
        if (mode === 'login' || mode === 'register') {
          if (mode === 'register') passwordMatch(values);
          state.user = mode === 'register' ? await api.register({ username: values.username, email: values.email, password: values.password, confirmPassword: values.confirmPassword, ...accountLegalPayload(form, legalConfig) }) : await api.login(values);
          navigate(next, { replace: true });
        } else if (mode === 'forgot-password') {
          const result = await api.forgotPassword(values);
          report(form, result.message || 'Если аккаунт существует, инструкция отправлена на указанный email.');
          form.reset();
        } else {
          passwordMatch(values);
          await api.resetPassword({ ...values, token: params.get('token') });
          state.user = null;
          navigate('/login?changed=1', { replace: true });
        }
      });
    },
  };
}

export function profileView(state) {
  const user = state.user;
  return {
    title: 'Профиль',
    html: `<div class="workspace-page">${heading('Профиль', 'Обновите контактные данные и пароль.')}<div class="split workspace-split"><section class="panel workspace-panel profile-panel"><div class="workspace-panel__heading"><h2>Личные данные</h2><p class="muted profile-panel__id">ID: <code>${e(user.id)}</code></p></div><form id="profile-form" class="stack">${usernameField(user.username)}${field('email', 'Email', { type: 'email', value: user.email, autocomplete: 'email' })}${field('currentPassword', 'Текущий пароль для подтверждения', { type: 'password', autocomplete: 'current-password', maxLength: 72 })}${formStatus()}<button>Сохранить профиль</button></form></section><section class="panel workspace-panel profile-panel"><div class="workspace-panel__heading"><h2>Смена пароля</h2></div><form id="password-form" class="stack">${field('currentPassword', 'Текущий пароль', { type: 'password', autocomplete: 'current-password', maxLength: 72 })}${passwordFields()}${formStatus()}<button>Изменить пароль</button><p class="muted profile-panel__note">Все активные сеансы будут завершены.</p></form></section></div></div>`,
    bind(root) {
      bindForm(root.querySelector('#profile-form'), async (values, form) => {
        state.user = await api.updateProfile(values);
        form.elements.currentPassword.value = '';
        document.querySelector('[data-account-name]').textContent = state.user.username;
        report(form, 'Профиль обновлён.');
      });
      bindForm(root.querySelector('#password-form'), async (values) => {
        passwordMatch(values);
        await api.changePassword(values);
        state.user = null;
        navigate('/login?changed=1', { replace: true });
      });
    },
  };
}
