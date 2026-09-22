/**
 * Three ways in:
 *  - a user JWT (the web app), carrying userId, accountId, role;
 *  - an API key `sp_..._...` in `Authorization: Bearer`, scoped to an account;
 *  - an admin JWT (the admin portal), which may name an account to view.
 * Each produces a Ctx on request.ctx. Handlers never read accountId from anywhere else.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../config/database.js';
import { accounts, apiKeys, users } from '../db/schema/index.js';
import { parseApiKey, verifyApiKey } from './api-key.js';
import type { Ctx } from './context.js';
import { ForbiddenError, UnauthorizedError } from './errors.js';

export interface UserJwt { kind: 'user'; userId: string; accountId: string; email: string; role: string }
export interface AdminJwt { kind: 'admin'; adminId: string; email: string }

declare module 'fastify' {
  interface FastifyRequest {
    ctx: Ctx;
    admin?: AdminJwt;
  }
}

async function ctxFromApiKey(raw: string, request: FastifyRequest): Promise<Ctx> {
  const parsed = parseApiKey(raw);
  if (!parsed) throw new UnauthorizedError('Malformed API key');
  const db = getDb();
  const [row] = await db.select().from(apiKeys).where(and(eq(apiKeys.prefix, parsed.prefix), isNull(apiKeys.revokedAt))).limit(1);
  if (!row || !verifyApiKey(parsed.secret, row.keyHash)) throw new UnauthorizedError('Invalid API key');
  const [acct] = await db.select({ status: accounts.status }).from(accounts).where(eq(accounts.id, row.accountId)).limit(1);
  if (!acct || acct.status === 'CLOSED') throw new UnauthorizedError('Account closed');
  void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id)).catch(() => undefined);
  const clientName = (request.headers['x-client-name'] as string | undefined) ?? row.clientName ?? null;
  return {
    accountId: row.accountId,
    actorKind: row.kind === 'mcp' ? 'mcp' : 'api_key',
    actorId: row.id,
    actorName: row.name,
    clientName,
    role: 'MANAGER',
    scopes: row.scopes,
  };
}

async function ctxFromUserJwt(request: FastifyRequest): Promise<Ctx> {
  const decoded = await request.jwtVerify<UserJwt | AdminJwt>();
  if (decoded.kind === 'admin') {
    request.admin = decoded;
    const viewing = (request.headers['x-account-id'] as string | undefined) ?? (request.query as { accountId?: string })?.accountId;
    if (!viewing) throw new ForbiddenError('Admin requests must name an account with the X-Account-Id header');
    return { accountId: viewing, actorKind: 'admin', actorId: decoded.adminId, actorName: decoded.email, clientName: 'admin-portal', role: 'ADMIN', scopes: ['*'] };
  }
  const db = getDb();
  const [u] = await db.select().from(users).where(and(eq(users.id, decoded.userId), isNull(users.deletedAt))).limit(1);
  if (!u) throw new UnauthorizedError('User no longer exists');
  return { accountId: u.accountId, actorKind: 'user', actorId: u.id, actorName: u.name, clientName: 'web', role: u.role, scopes: ['*'] };
}

/** preHandler: any authenticated caller (user, key or admin viewing an account). */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new UnauthorizedError();
  request.ctx = token.startsWith('sp_') ? await ctxFromApiKey(token, request) : await ctxFromUserJwt(request);
}

/** preHandler: signed-in users only (not keys), for team and billing pages. */
export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (request.ctx.actorKind !== 'user' && request.ctx.actorKind !== 'admin') throw new ForbiddenError('Sign in as a user for this');
}

/** preHandler: platform admins only. */
export async function requireAdmin(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const decoded = await request.jwtVerify<UserJwt | AdminJwt>().catch(() => null);
  if (!decoded || decoded.kind !== 'admin') throw new UnauthorizedError('Admin sign in required');
  request.admin = decoded;
}
