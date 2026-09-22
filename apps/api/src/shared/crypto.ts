/**
 * AES-256-GCM at-rest encryption for courier credentials and cached sessions.
 * Key derived from ENCRYPTION_KEY (falling back to JWT_SECRET) with scrypt.
 * Storage format: `<iv-hex>:<authTag-hex>:<ciphertext-hex>`.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { getEnv } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KDF_SALT = Buffer.from('spv4-encrypt-v1', 'utf8');
let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const env = getEnv();
  const secret = env.ENCRYPTION_KEY ?? env.JWT_SECRET;
  cachedKey = scryptSync(secret, KDF_SALT, 32);
  return cachedKey;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct.toString('hex')}`;
}

export function decrypt(stored: string): string {
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('decrypt(): malformed ciphertext envelope');
  const [ivHex, tagHex, ctHex] = parts as [string, string, string];
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
}

export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

export function decryptJson<T = Record<string, string>>(stored: string): T {
  return JSON.parse(decrypt(stored)) as T;
}
