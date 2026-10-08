import { prisma } from '../config/db.js';
import { initializeLegal } from '../services/legal.js';
import { retentionMaintenance } from '../services/retention.js';
try { await initializeLegal(); console.log(JSON.stringify(await retentionMaintenance({ dryRun: !process.argv.includes('--execute') }))); }
finally { await prisma.$disconnect(); }
