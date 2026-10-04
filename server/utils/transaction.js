import { prisma } from '../config/db.js';
export async function serializable(fn) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await prisma.$transaction(fn, { isolationLevel: 'Serializable', timeout: 15000 }); }
    catch (error) {
      if (!['P2034','P2002'].includes(error.code) || attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}
