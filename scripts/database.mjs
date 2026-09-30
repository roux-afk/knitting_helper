import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const data = resolve('data/postgres');
const socket = `/tmp/knitting-tracker-${process.getuid?.() ?? 'local'}`;
export const connection = process.env.DATABASE_URL || {host: socket, port: 5432, user: 'knitting', database: 'knitting'};
function run(cmd, args) {
  const result = spawnSync(cmd, args, {stdio: 'inherit'});
  if (result.status !== 0) throw new Error(`${cmd} failed. PostgreSQL tools must be installed.`);
}
const action = process.argv[2];
if (action === 'start') {
  if (process.env.DATABASE_URL) throw new Error('Use your external PostgreSQL service directly.');
  mkdirSync(resolve('data'), {recursive: true, mode: 0o700});
  mkdirSync(socket, {recursive: true, mode: 0o700});
  if (!existsSync(`${data}/PG_VERSION`)) run('initdb', ['-D', data, '-U', 'knitting', '--encoding=UTF8', '--locale=C', '--auth-local=trust', '--auth-host=reject']);
  const status = spawnSync('pg_ctl', ['-D', data, 'status'], {stdio: 'ignore'});
  if (status.status !== 0) run('pg_ctl', ['-D', data, '-l', resolve('data/postgres.log'), '-o', `-k ${socket} -h ''`, '-w', 'start']);
  const admin = new pg.Client({...connection, database:'postgres'});
  await admin.connect();
  if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='knitting'")).rowCount) await admin.query('CREATE DATABASE knitting');
  await admin.end();
  console.log('Local database ready. Run npm run db:migrate.');
} else if (action === 'stop') {
  run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
} else if (action === 'migrate') {
  const client = new pg.Client(typeof connection === 'string' ? {connectionString:connection} : connection);
  await client.connect();
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  for (const name of readdirSync('db/migrations').filter(x => x.endsWith('.sql')).sort()) {
    if ((await client.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name])).rowCount) continue;
    await client.query('BEGIN');
    try {
      await client.query(readFileSync(`db/migrations/${name}`, 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);
      await client.query('COMMIT');
      console.log(`Applied ${name}`);
    } catch(error) { await client.query('ROLLBACK'); throw error; }
  }
  await client.end();
} else throw new Error('Expected start, stop or migrate');
