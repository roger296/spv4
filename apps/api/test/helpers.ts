import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getDb } from '../src/config/database.js';
import { warehouses } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';

let counter = 0;

export async function testApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

export interface TestAccount { token: string; accountId: string; userId: string; email: string; warehouseId: string }

/** Sign up a fresh account with a complete default warehouse. */
export async function signUp(app: FastifyInstance, name = 'Test Co'): Promise<TestAccount> {
  counter += 1;
  const email = `owner${counter}-${Date.now()}@example.test`;
  const res = await app.inject({ method: 'POST', url: '/v4/auth/sign-up', payload: { companyName: `${name} ${counter}`, name: 'Owner', email, password: 'correct-horse-9' } });
  if (res.statusCode !== 201) throw new Error(`sign-up failed: ${res.body}`);
  const body = res.json();
  const [w] = await getDb().select().from(warehouses).where(eq(warehouses.accountId, body.account.id));
  await getDb().update(warehouses).set({ line1: '1 Test Street', city: 'Wilmslow', postCode: 'SK9 6BH', country: 'GB', phone: '01625000000', eori: 'GB123456789000' }).where(eq(warehouses.id, w!.id));
  return { token: body.token, accountId: body.account.id, userId: body.user.id, email, warehouseId: w!.id };
}

export function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

export const ukAddress = { contactName: 'Jane Tompkins', line1: '12 High Street', city: 'Manchester', postCode: 'M1 1AA', country: 'GB', phone: '07700900000', email: 'jane@example.test' };
