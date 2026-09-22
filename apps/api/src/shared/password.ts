import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function validatePasswordStrength(plain: string): string | null {
  if (plain.length < 10) return 'Password must be at least 10 characters';
  if (!/[a-z]/i.test(plain) || !/\d/.test(plain)) return 'Password must contain letters and a number';
  return null;
}
