/**
 * Vitest global setup for @spv4/api.
 * Integration tests run against a dedicated test database and never touch dev data.
 *   1. TEST_DATABASE_URL
 *   2. the docker-compose default spv4_test on port 5433
 * The chosen URL is copied into DATABASE_URL, which every module reads via config/env.
 */
import 'dotenv/config';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://spv4:spv4@localhost:5433/spv4_test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-not-for-production';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
process.env.DOCUMENTS_DIR ??= './.tmp-test-documents';
process.env.LOG_LEVEL ??= 'silent';
