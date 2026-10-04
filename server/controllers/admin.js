import { asyncHandler } from '../utils/async.js';
import * as admin from '../services/admin.js';

const read = (fn) => asyncHandler(async (req, res) => {
  res.json({ success: true, data: await fn(req.validated.query) });
});
const write = (fn, status = 200) => asyncHandler(async (req, res) => {
  const data = await fn(req.user.id, req.validated.params.id, req.validated.body);
  res.status(status).json({ success: true, data });
});

export const dashboard = read(admin.dashboard);
export const users = read(admin.listUsers);
export const products = read(admin.listProducts);
export const plans = read(admin.listPlans);
export const promos = read(admin.listPromos);
export const orders = read(admin.listOrders);
export const subscriptions = read(admin.listSubscriptions);
export const payments = read(admin.listPayments);
export const logs = read(admin.listLogs);
export const updateUser = write(admin.updateUser);
export const createProduct = write(admin.createProduct, 201);
export const updateProduct = write(admin.updateProduct);
export const deactivateProduct = write(admin.deactivateProduct);
export const createPlan = write(admin.createPlan, 201);
export const updatePlan = write(admin.updatePlan);
export const createPromo = write(admin.createPromo, 201);
export const updatePromo = write(admin.updatePromo);
export const createSubscription = write(admin.createSubscription, 201);
export const updateSubscription = write(admin.updateSubscription);
