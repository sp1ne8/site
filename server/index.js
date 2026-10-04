import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/db.js';
import { expireOrders } from './services/orders.js';
await prisma.$connect();
const server = app.listen(env.PORT,()=>console.log(`API ready: ${env.SERVER_URL}`));
let maintenanceRunning = false;
const maintenance = setInterval(async()=>{
  if (maintenanceRunning) return;
  maintenanceRunning=true;
  try {
    await expireOrders();
    await prisma.subscription.updateMany({where:{status:'active',expiresAt:{lte:new Date()}},data:{status:'expired'}});
    await prisma.session.deleteMany({where:{expiresAt:{lte:new Date()}}});
    await prisma.passwordReset.deleteMany({where:{expiresAt:{lte:new Date()}}});
  } catch (error) { console.error(JSON.stringify({event:'maintenance_error',code:error.code})); }
  finally {maintenanceRunning=false;}
},60000);
maintenance.unref();
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{clearInterval(maintenance);server.close(async()=>{await prisma.$disconnect();process.exit(0);});});
