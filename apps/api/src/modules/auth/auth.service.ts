import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../../config/database.js';
import { getEnv } from '../../config/env.js';
import { accounts, adminUsers, users, warehouses } from '../../db/schema/index.js';
import { audit } from '../../shared/audit.js';
import type { Ctx } from '../../shared/context.js';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../../shared/errors.js';
import { hashPassword, randomToken, validatePasswordStrength, verifyPassword } from '../../shared/password.js';
import type { UserJwt, AdminJwt } from '../../shared/auth-middleware.js';

export interface SignUpInput {
  companyName: string;
  name: string;
  email: string;
  password: string;
  country?: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'account';
}

export class AuthService {
  private db = getDb();

  /** Creates the account, its owner and a default warehouse (address to be filled in Settings). */
  async signUp(input: SignUpInput) {
    const weak = validatePasswordStrength(input.password);
    if (weak) throw new ValidationError(weak);
    const email = input.email.trim().toLowerCase();
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new ConflictError('An account already uses that email address');

    const base = slugify(input.companyName);
    let slug = base;
    for (let i = 2; ; i++) {
      const [taken] = await this.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.slug, slug)).limit(1);
      if (!taken) break;
      slug = `${base}-${i}`;
    }
    const env = getEnv();
    const trialEndsAt = new Date(Date.now() + env.TRIAL_DAYS * 86_400_000);
    const passwordHash = await hashPassword(input.password);

    return this.db.transaction(async (tx) => {
      const [account] = await tx.insert(accounts).values({ name: input.companyName.trim(), slug, trialEndsAt }).returning();
      const [user] = await tx.insert(users).values({ accountId: account!.id, email, name: input.name.trim(), role: 'OWNER', passwordHash, lastSignInAt: new Date() }).returning();
      await tx.insert(warehouses).values({ accountId: account!.id, name: 'Main warehouse', isDefault: true, country: (input.country ?? 'GB').toUpperCase(), company: input.companyName.trim(), contactName: input.name.trim(), email });
      const ctx: Ctx = { accountId: account!.id, actorKind: 'user', actorId: user!.id, actorName: user!.name, clientName: 'web', role: 'OWNER', scopes: ['*'] };
      await audit(ctx, { action: 'account.created', entityType: 'account', entityId: account!.id, after: { name: account!.name } }, tx);
      return { account: account!, user: user! };
    });
  }

  async signIn(email: string, password: string) {
    const [u] = await this.db.select().from(users).where(and(eq(users.email, email.trim().toLowerCase()), isNull(users.deletedAt))).limit(1);
    if (!u || !u.passwordHash || !(await verifyPassword(u.passwordHash, password))) throw new UnauthorizedError('Email or password is wrong');
    const [acct] = await this.db.select().from(accounts).where(eq(accounts.id, u.accountId)).limit(1);
    if (!acct || acct.status === 'CLOSED') throw new UnauthorizedError('This account is closed');
    await this.db.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, u.id));
    return { user: u, account: acct };
  }

  userClaims(u: { id: string; accountId: string; email: string; role: string }): UserJwt {
    return { kind: 'user', userId: u.id, accountId: u.accountId, email: u.email, role: u.role };
  }

  async me(ctx: Ctx) {
    const [acct] = await this.db.select().from(accounts).where(eq(accounts.id, ctx.accountId)).limit(1);
    if (!acct) throw new NotFoundError('account');
    const user = ctx.actorKind === 'user' && ctx.actorId
      ? (await this.db.select({ id: users.id, email: users.email, name: users.name, role: users.role }).from(users).where(eq(users.id, ctx.actorId)).limit(1))[0]
      : null;
    return { account: { id: acct.id, name: acct.name, slug: acct.slug, currency: acct.currency, stationery: acct.stationery, status: acct.status, trialEndsAt: acct.trialEndsAt, settings: acct.settings }, user, actor: { kind: ctx.actorKind, role: ctx.role } };
  }

  /** Invitation: creates the user without a password and returns the token to send by email. */
  async invite(ctx: Ctx, input: { email: string; name: string; role: 'MANAGER' | 'OPERATOR' | 'READ_ONLY' }) {
    const email = input.email.trim().toLowerCase();
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new ConflictError('That email already has a login');
    const token = randomToken(24);
    const [u] = await this.db.insert(users).values({ accountId: ctx.accountId, email, name: input.name.trim(), role: input.role, inviteToken: token, inviteExpiresAt: new Date(Date.now() + 7 * 86_400_000) }).returning();
    await audit(ctx, { action: 'user.invited', entityType: 'user', entityId: u!.id, after: { email, role: input.role } });
    return { user: u!, token };
  }

  async acceptInvite(token: string, password: string) {
    const weak = validatePasswordStrength(password);
    if (weak) throw new ValidationError(weak);
    const [u] = await this.db.select().from(users).where(eq(users.inviteToken, token)).limit(1);
    if (!u || !u.inviteExpiresAt || u.inviteExpiresAt < new Date()) throw new UnauthorizedError('This invitation is no longer valid');
    const passwordHash = await hashPassword(password);
    const [updated] = await this.db.update(users).set({ passwordHash, inviteToken: null, inviteExpiresAt: null, lastSignInAt: new Date() }).where(eq(users.id, u.id)).returning();
    return updated!;
  }

  async requestPasswordReset(email: string): Promise<{ token: string; userId: string } | null> {
    const [u] = await this.db.select().from(users).where(and(eq(users.email, email.trim().toLowerCase()), isNull(users.deletedAt))).limit(1);
    if (!u) return null;
    const token = randomToken(24);
    await this.db.update(users).set({ resetToken: token, resetExpiresAt: new Date(Date.now() + 2 * 3_600_000) }).where(eq(users.id, u.id));
    return { token, userId: u.id };
  }

  async resetPassword(token: string, password: string) {
    const weak = validatePasswordStrength(password);
    if (weak) throw new ValidationError(weak);
    const [u] = await this.db.select().from(users).where(eq(users.resetToken, token)).limit(1);
    if (!u || !u.resetExpiresAt || u.resetExpiresAt < new Date()) throw new UnauthorizedError('This reset link is no longer valid');
    await this.db.update(users).set({ passwordHash: await hashPassword(password), resetToken: null, resetExpiresAt: null }).where(eq(users.id, u.id));
    return u;
  }

  async listTeam(ctx: Ctx) {
    return this.db.select({ id: users.id, email: users.email, name: users.name, role: users.role, lastSignInAt: users.lastSignInAt, pending: users.inviteToken }).from(users).where(and(eq(users.accountId, ctx.accountId), isNull(users.deletedAt)));
  }

  async updateTeamMember(ctx: Ctx, userId: string, patch: { role?: 'OWNER' | 'MANAGER' | 'OPERATOR' | 'READ_ONLY'; name?: string }) {
    const [u] = await this.db.select().from(users).where(and(eq(users.id, userId), eq(users.accountId, ctx.accountId))).limit(1);
    if (!u) throw new NotFoundError('user', userId);
    const [updated] = await this.db.update(users).set({ ...patch, updatedAt: new Date() }).where(eq(users.id, userId)).returning();
    await audit(ctx, { action: 'user.updated', entityType: 'user', entityId: userId, before: { role: u.role, name: u.name }, after: patch });
    return updated!;
  }

  async removeTeamMember(ctx: Ctx, userId: string) {
    if (ctx.actorId === userId) throw new ValidationError('You cannot remove yourself');
    const [u] = await this.db.select().from(users).where(and(eq(users.id, userId), eq(users.accountId, ctx.accountId))).limit(1);
    if (!u) throw new NotFoundError('user', userId);
    await this.db.update(users).set({ deletedAt: new Date(), passwordHash: null, inviteToken: null }).where(eq(users.id, userId));
    await audit(ctx, { action: 'user.removed', entityType: 'user', entityId: userId, before: { email: u.email } });
  }

  // ---- platform admins ----
  async adminSignIn(email: string, password: string): Promise<AdminJwt> {
    const [a] = await this.db.select().from(adminUsers).where(eq(adminUsers.email, email.trim().toLowerCase())).limit(1);
    if (!a || !(await verifyPassword(a.passwordHash, password))) throw new UnauthorizedError('Email or password is wrong');
    await this.db.update(adminUsers).set({ lastSignInAt: new Date() }).where(eq(adminUsers.id, a.id));
    return { kind: 'admin', adminId: a.id, email: a.email };
  }

  async createAdmin(email: string, name: string, password: string) {
    const [a] = await this.db.insert(adminUsers).values({ email: email.trim().toLowerCase(), name, passwordHash: await hashPassword(password) }).onConflictDoNothing().returning();
    return a ?? null;
  }
}
