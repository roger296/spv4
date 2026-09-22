import { buildApp } from './app.js';
import { getEnv } from './config/env.js';
import { closeDatabase } from './config/database.js';
import './modules/register.js';

async function main() {
  const env = getEnv();
  const app = await buildApp();
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Smooth Parcel V4 API at http://${env.HOST}:${env.PORT} (docs at /docs)`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await closeDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
