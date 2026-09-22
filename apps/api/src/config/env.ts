import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3100),
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().default('postgresql://spv4:spv4@localhost:5433/spv4'),
  JWT_SECRET: z.string().min(8),
  ENCRYPTION_KEY: z.string().min(8).optional(),
  DOCUMENTS_DIR: z.string().default('./documents'),
  APP_ORIGIN: z.string().default('http://localhost:5174'),
  API_ORIGIN: z.string().default('http://localhost:3100'),
  TRACK_ORIGIN: z.string().default('http://localhost:3100/track'),
  MOLLIE_API_KEY: z.string().optional(),
  MOLLIE_WEBHOOK_URL: z.string().optional(),
  SUBSCRIPTION_WEEKLY_AMOUNT_GBP: z.string().default('15.00'),
  TRIAL_DAYS: z.coerce.number().default(14),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),
  AI_DAILY_BUDGET_GBP: z.coerce.number().default(5),
  TRACKING_POLL_CRON: z.string().default('15 */4 * * *'),
  DOCUMENT_RETENTION_DAYS: z.coerce.number().default(548),
  PGBOSS_SCHEMA: z.string().default('pgboss'),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Smooth Parcel <no-reply@smoothparcel.com>'),
});

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function resetEnvForTests(): void {
  cached = undefined;
}
