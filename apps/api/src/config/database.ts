import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { getEnv } from './env.js';
import * as schema from '../db/schema/index.js';

export type Db = ReturnType<typeof drizzle<typeof schema>>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

let _db: Db | undefined;
let _pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!_pool) {
    _pool = new pg.Pool({
      connectionString: getEnv().DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return _pool;
}

export function getDb(): Db {
  if (!_db) _db = drizzle(getPool(), { schema });
  return _db;
}

export async function closeDatabase(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
    _db = undefined;
  }
}
