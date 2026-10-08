// All authorization lives in an HttpOnly cookie. No token or secret is stored here.
const baseUrl = '/api';

export class ApiError extends Error {
  constructor(message, status) { super(message); this.name = 'ApiError'; this.status = status; }
}

export async function request(path, { method = 'GET', body, ...options } = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      method,
      credentials: 'include',
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(!['GET', 'HEAD'].includes(method) ? { 'X-Requested-With': 'XMLHttpRequest' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError('Не удалось связаться с сервером. Проверьте соединение и повторите попытку.', 0);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new ApiError(payload?.message || `Ошибка сервера (${response.status}). Повторите попытку.`, response.status);
  }
  return payload.data;
}

function query(values = {}) {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== '' && value != null) result.set(key, String(value));
  return result.size ? `?${result}` : '';
}

const post = (path, body = {}) => request(path, { method: 'POST', body });
const patch = (path, body) => request(path, { method: 'PATCH', body });
const id = encodeURIComponent;
export const register = (body) => post('/auth/register', body);
export const login = (body) => post('/auth/login', body);
export const logout = () => post('/auth/logout');
export const getCurrentUser = () => request('/auth/me');
export const forgotPassword = (body) => post('/auth/forgot-password', body);
export const resetPassword = (body) => post('/auth/reset-password', body);
export const updateProfile = (body) => patch('/users/me', body);
export const changePassword = (body) => patch('/users/me/password', body);
export const getProducts = (params) => request(`/products${query(params)}`);
export const getProduct = (slug) => request(`/products/${id(slug)}`);
export const getPlans = (productId) => request(`/plans${query({ productId })}`);
export const createOrder = (body) => post('/orders', body);
export const getOrders = (params) => request(`/orders${query(params)}`);
export const getOrder = (orderId) => request(`/orders/${id(orderId)}`);
export const cancelOrder = (orderId) => post(`/orders/${id(orderId)}/cancel`);
export const getSubscriptions = () => request('/subscriptions');
export const checkPromoCode = (body) => post('/promocodes/check', body);
export const getPayment = (paymentId) => request(`/payments/${id(paymentId)}`);
export const getAdminDashboard = () => request('/admin/dashboard');
export const adminList = (resource, params) => request(`/admin/${id(resource)}${query(params)}`);
export const adminCreate = (resource, body) => post(`/admin/${id(resource)}`, body);
export const adminUpdate = (resource, resourceId, body) => patch(`/admin/${id(resource)}/${id(resourceId)}`, body);
export const adminDelete = (resource, resourceId) => request(`/admin/${id(resource)}/${id(resourceId)}`, { method: 'DELETE' });
export const getLegalConfig = (jurisdiction = 'RU') => request(`/legal/config${query({ jurisdiction })}`);
export const getLegalDocument = documentId => request(`/legal/documents/${id(documentId)}`);
export const getLegalDocumentHistory = documentId => request(`/admin/legal/documents/${id(documentId)}/history`);
export const getCookieConsents = jurisdiction => request(`/legal/consents${query({ jurisdiction })}`);
export const saveCookieConsents = body => post('/legal/consents/cookies', body);
export const getPrivacyOverview = () => request('/privacy');
export const exportPrivacyData = () => request('/privacy/export');
export const createPrivacyRequest = body => post('/privacy/requests', body);
export const withdrawPrivacyConsent = type => post('/privacy/consents/withdraw', { type });
export const confirmPrivacyPolicy = body => post('/privacy/acknowledge', body);
export const getLegalAdmin = (resource, params) => request(`/admin/legal/${id(resource)}${query(params)}`);
export const createLegalDocument = body => post('/admin/legal/documents', body);
export const editLegalDocument = (documentId, body) => patch(`/admin/legal/documents/${id(documentId)}`, body);
export const publishLegalDocument = documentId => post(`/admin/legal/documents/${id(documentId)}/publish`, { legallyReviewed: true });
export const updateJurisdiction = (code, body) => patch(`/admin/legal/jurisdictions/${id(code)}`, body);
export const updateDataRequest = (requestId, body) => patch(`/admin/legal/requests/${id(requestId)}`, body);
export const closePrivacyAccount = (requestId, body) => post(`/admin/legal/requests/${id(requestId)}/close-account`, body);
