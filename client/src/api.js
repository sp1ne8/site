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
