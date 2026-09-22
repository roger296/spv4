/**
 * Request context: who is acting and for which account.
 * Every service method takes a Ctx and every query is scoped by ctx.accountId.
 * The AsyncLocalStorage copy lets deep code (audit, engine) read the actor without threading it.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { UserRole } from '@spv4/shared-types';
import { ForbiddenError } from './errors.js';

export type ActorKind = 'user' | 'api_key' | 'mcp' | 'system' | 'admin';

export interface Ctx {
  accountId: string;
  actorKind: ActorKind;
  actorId: string | null;
  actorName: string | null;
  clientName: string | null;
  role: UserRole | 'SYSTEM' | 'ADMIN';
  scopes: string[];
}

const storage = new AsyncLocalStorage<Ctx>();

export function runWithCtx<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function currentCtx(): Ctx | undefined {
  return storage.getStore();
}

export function systemCtx(accountId: string, actorName = 'system'): Ctx {
  return { accountId, actorKind: 'system', actorId: null, actorName, clientName: null, role: 'SYSTEM', scopes: ['*'] };
}

const ROLE_RANK: Record<string, number> = { READ_ONLY: 0, OPERATOR: 1, MANAGER: 2, OWNER: 3, SYSTEM: 4, ADMIN: 4 };

/** Throws unless the actor holds at least `role` (users) or the scope (keys). */
export function requireRole(ctx: Ctx, role: UserRole): void {
  if ((ROLE_RANK[ctx.role] ?? -1) < (ROLE_RANK[role] ?? 99)) {
    throw new ForbiddenError(`This action needs the ${role.toLowerCase().replace('_', ' ')} role`);
  }
}

export function requireScope(ctx: Ctx, scope: string): void {
  if (ctx.actorKind === 'user' || ctx.actorKind === 'system' || ctx.actorKind === 'admin') return;
  if (ctx.scopes.includes('*') || ctx.scopes.includes(scope)) return;
  throw new ForbiddenError(`This key lacks the ${scope} scope`);
}

/** Write access: users need OPERATOR+, keys need the scope. */
export function requireWrite(ctx: Ctx, scope: string, role: UserRole = 'OPERATOR'): void {
  if (ctx.actorKind === 'user') requireRole(ctx, role);
  else requireScope(ctx, scope);
}
