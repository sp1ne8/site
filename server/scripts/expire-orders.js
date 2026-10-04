import '../config/env.js';
import { prisma } from '../config/db.js';
import { expireOrders } from '../services/orders.js';
try { console.log(`Expired pending orders: ${await expireOrders()}`); } finally {await prisma.$disconnect();}
