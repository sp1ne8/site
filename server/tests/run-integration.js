import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const original = new URL(process.env.DATABASE_URL);
const target = new URL(process.env.TEST_DATABASE_URL || original.href);
if (!process.env.TEST_DATABASE_URL) target.pathname = `${original.pathname}_test`;
const name = decodeURIComponent(target.pathname.slice(1));
if (!/^[a-zA-Z0-9_]+_test$/.test(name)) throw new Error('Use a separate database whose name ends in _test.');
if (!process.env.TEST_DATABASE_URL && !['localhost', '127.0.0.1', '[::1]'].includes(original.hostname)) throw new Error('Set TEST_DATABASE_URL explicitly for a remote test database.');
const connection = new PrismaClient({ datasourceUrl: original.href });
try {
  const found = await connection.$queryRaw`SELECT datname FROM pg_database WHERE datname = ${name}`;
  if (!found.length) await connection.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
} finally { await connection.$disconnect(); }
process.env.DATABASE_URL = target.href; process.env.NODE_ENV = 'test'; process.env.SMTP_HOST = '';
const root = fileURLToPath(new URL('../../', import.meta.url));
const run = args => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true });
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Command failed (${code}).`)));
});
await run(['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'server/prisma/schema.prisma']);
console.log(`Isolated integration database ready: ${name}`);
if (!process.argv.includes('--prepare')) await run(['--test', '--test-concurrency=1', 'server/tests/integration.test.js', 'server/tests/privacy.test.js']);
