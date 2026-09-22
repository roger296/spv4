/**
 * API keys look like `sp_<8 hex>_<32 hex>` (47 characters, two underscores), matching the
 * smmta-next convention. Only the scrypt hash is stored; the prefix is the lookup key.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface GeneratedKey {
  raw: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(): GeneratedKey {
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(16).toString('hex');
  const raw = `sp_${prefix}_${secret}`;
  return { raw, prefix, hash: hashSecret(secret) };
}

export function parseApiKey(raw: string): { prefix: string; secret: string } | null {
  const m = /^sp_([0-9a-f]{8})_([0-9a-f]{32})$/.exec(raw.trim());
  if (!m) return null;
  return { prefix: m[1]!, secret: m[2]! };
}

function hashSecret(secret: string, saltHex?: string): string {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(16);
  const derived = scryptSync(secret, salt, 32);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyApiKey(secret: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const candidate = hashSecret(secret, saltHex).split(':')[1]!;
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hashHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
