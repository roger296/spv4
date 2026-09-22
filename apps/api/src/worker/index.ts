/**
 * Background worker: pg-boss in the same Postgres. Jobs:
 *  - tracking-poll        every 4 hours (TRACKING_POLL_CRON): poll live shipments
 *  - exception-rules      hourly: no-scan / stalled / late problems
 *  - webhook-deliver      every minute: send queued webhook deliveries with retry
 *  - document-retention   daily 03:10: delete documents past DOCUMENT_RETENTION_DAYS
 *  - problem-digest       daily 07:30: email open problems to accounts that want it
 *  - subscription-check   daily 06:00: move trials and arrears along
 * Run with `npm run worker`. `npx tsx src/worker/index.ts --once <job>` runs one job and exits.
 */
import PgBoss from 'pg-boss';
import { getEnv } from '../config/env.js';
import { closeDatabase } from '../config/database.js';
import '../modules/register.js';
import { JOBS, runJob } from './jobs.js';

async function main() {
  const env = getEnv();
  const onceIdx = process.argv.indexOf('--once');
  if (onceIdx !== -1) {
    const name = process.argv[onceIdx + 1] as keyof typeof JOBS | undefined;
    if (!name || !(name in JOBS)) { console.error(`Usage: --once <${Object.keys(JOBS).join('|')}>`); process.exit(2); }
    const result = await runJob(name);
    console.log(JSON.stringify(result));
    await closeDatabase();
    return;
  }
  const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: env.PGBOSS_SCHEMA });
  boss.on('error', (err) => console.error('[worker] pg-boss error', err));
  await boss.start();
  for (const [name, job] of Object.entries(JOBS)) {
    await boss.createQueue(name).catch(() => undefined);
    await boss.work(name, { batchSize: 1 }, async () => { const r = await runJob(name as keyof typeof JOBS); console.log(`[worker] ${name}`, JSON.stringify(r)); });
    const cron = name === 'tracking-poll' ? env.TRACKING_POLL_CRON : job.cron;
    await boss.schedule(name, cron, {}, { tz: 'Europe/London' });
    console.log(`[worker] scheduled ${name} (${cron})`);
  }
  const shutdown = async () => { await boss.stop({ graceful: true }); await closeDatabase(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => { console.error(err); process.exit(1); });
