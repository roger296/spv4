/**
 * Apply drizzle migrations. `--test` targets TEST_DATABASE_URL (default spv4_test on 5433).
 * Usage: npx tsx scripts/migrate.ts [--test]
 */
import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const isTest = process.argv.includes('--test');
const url = isTest
  ? (process.env.TEST_DATABASE_URL ?? 'postgresql://spv4:spv4@localhost:5433/spv4_test')
  : (process.env.DATABASE_URL ?? 'postgresql://spv4:spv4@localhost:5433/spv4');

const pool = new pg.Pool({ connectionString: url });
const db = drizzle(pool);
await migrate(db, { migrationsFolder: resolve(here, '../src/db/migrations') });
console.log(`Migrations applied to ${url.replace(/:[^:@/]+@/, ':***@')}`);
await pool.end();
