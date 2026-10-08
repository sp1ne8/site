import { spawn } from 'node:child_process';
import { createCipheriv, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, appendFile, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
// pg_dump password is supplied via child environment, never command line/logs.
if (!env.BACKUP_ENCRYPTION_KEY) throw new Error('Configure a separate 32-byte BACKUP_ENCRYPTION_KEY; keep it outside the backup location.');
const database = new URL(env.DATABASE_URL);
const directory = fileURLToPath(new URL('../storage/backups/', import.meta.url));
await mkdir(directory, { recursive: true });
const filename = `${directory}/hydra-${new Date().toISOString().replaceAll(':', '-')}.pgdump.enc`;
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', Buffer.from(env.BACKUP_ENCRYPTION_KEY, 'hex'), iv);
const output = createWriteStream(filename, { flags: 'wx', mode: 0o600 });
output.write(Buffer.concat([Buffer.from('HYDRABK1'), iv]));
const child = spawn(env.PG_DUMP_PATH || 'pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--host', database.hostname, '--port', database.port || '5432', '--username', decodeURIComponent(database.username), decodeURIComponent(database.pathname.slice(1))], { windowsHide: true, env: { ...process.env, PGPASSWORD: decodeURIComponent(database.password), PGSSLMODE: database.searchParams.get('sslmode') || 'prefer' }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stderr.resume(); // Avoid accidental secret/record disclosure from diagnostics.
const completed = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('pg_dump failed; check executable, database access and server version.'))); });
try { await Promise.all([pipeline(child.stdout, cipher, output), completed]); await appendFile(filename, cipher.getAuthTag()); console.log(`Encrypted backup saved: ${filename}`); }
catch (error) { child.kill(); await unlink(filename).catch(() => {}); throw error; }
