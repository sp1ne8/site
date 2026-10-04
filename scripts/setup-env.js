import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const source = new URL('../server/.env.example', import.meta.url);
const target = new URL('../server/.env', import.meta.url);
const template = await readFile(source, 'utf8');
try {
  await writeFile(target, template.replace('replace-with-random-64-character-secret', randomBytes(32).toString('hex')).replace('replace-with-a-strong-local-password', randomBytes(18).toString('base64url')), { flag:'wx', mode:0o600 });
  console.log('Created server/.env. The generated local admin password is in SEED_ADMIN_PASSWORD. Existing files are never overwritten.');
} catch (error) { if (error.code === 'EEXIST') console.log('server/.env already exists; unchanged.'); else throw error; }
