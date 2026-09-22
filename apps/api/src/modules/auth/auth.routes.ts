import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from './auth.service.js';
import { requireAuth, requireUser } from '../../shared/auth-middleware.js';
import { requireRole } from '../../shared/context.js';
import { getEnv } from '../../config/env.js';
import { sendMail } from '../../shared/mail.js';

const signUpSchema = z.object({
  companyName: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(1),
  country: z.string().length(2).optional(),
});

export async function authRoutes(app: FastifyInstance) {
  const svc = new AuthService();
  const sign = (claims: object) => app.jwt.sign(claims, { expiresIn: '30d' });

  app.post('/auth/sign-up', async (req, reply) => {
    const input = signUpSchema.parse(req.body);
    const { account, user } = await svc.signUp(input);
    const token = sign(svc.userClaims(user));
    return reply.status(201).send({ token, account: { id: account.id, name: account.name }, user: { id: user.id, email: user.email, role: user.role } });
  });

  app.post('/auth/sign-in', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { email, password } = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
    const { user, account } = await svc.signIn(email, password);
    return { token: sign(svc.userClaims(user)), account: { id: account.id, name: account.name, status: account.status }, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (req) => svc.me(req.ctx));

  app.post('/auth/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const r = await svc.requestPasswordReset(email);
    if (r) {
      await sendMail({ to: email, subject: 'Reset your Smooth Parcel password', text: `Reset your password: ${getEnv().APP_ORIGIN}/reset-password?token=${r.token}\nThe link works for two hours.` });
    }
    return { ok: true };
  });

  app.post('/auth/reset-password', async (req) => {
    const { token, password } = z.object({ token: z.string(), password: z.string() }).parse(req.body);
    const user = await svc.resetPassword(token, password);
    return { token: sign(svc.userClaims(user)) };
  });

  app.post('/auth/accept-invite', async (req) => {
    const { token, password } = z.object({ token: z.string(), password: z.string() }).parse(req.body);
    const user = await svc.acceptInvite(token, password);
    return { token: sign(svc.userClaims(user)), user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  // ---- team ----
  app.get('/team', { preHandler: requireUser }, async (req) => svc.listTeam(req.ctx));

  app.post('/team/invite', { preHandler: requireUser }, async (req, reply) => {
    requireRole(req.ctx, 'MANAGER');
    const input = z.object({ email: z.string().email(), name: z.string().min(1), role: z.enum(['MANAGER', 'OPERATOR', 'READ_ONLY']) }).parse(req.body);
    const { user, token } = await svc.invite(req.ctx, input);
    await sendMail({ to: user.email, subject: 'You have been invited to Smooth Parcel', text: `Set your password to join: ${getEnv().APP_ORIGIN}/accept-invite?token=${token}` });
    return reply.status(201).send({ id: user.id, email: user.email, role: user.role, inviteToken: getEnv().NODE_ENV === 'production' ? undefined : token });
  });

  app.patch('/team/:id', { preHandler: requireUser }, async (req) => {
    requireRole(req.ctx, 'MANAGER');
    const { id } = req.params as { id: string };
    const patch = z.object({ role: z.enum(['OWNER', 'MANAGER', 'OPERATOR', 'READ_ONLY']).optional(), name: z.string().min(1).optional() }).parse(req.body);
    if (patch.role === 'OWNER') requireRole(req.ctx, 'OWNER');
    return svc.updateTeamMember(req.ctx, id, patch);
  });

  app.delete('/team/:id', { preHandler: requireUser }, async (req, reply) => {
    requireRole(req.ctx, 'MANAGER');
    await svc.removeTeamMember(req.ctx, (req.params as { id: string }).id);
    return reply.status(204).send();
  });

  // ---- platform admin sign-in ----
  app.post('/admin/auth/sign-in', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { email, password } = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
    const claims = await svc.adminSignIn(email, password);
    return { token: app.jwt.sign(claims, { expiresIn: '12h' }), admin: { email: claims.email } };
  });
}
