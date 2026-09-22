/**
 * The MCP server (spec section 11), served over Streamable HTTP at /mcp, plus a small OAuth 2.1
 * authorisation server (PKCE, dynamic client registration) so Claude Cowork and other MCP
 * clients can connect with a sign-in rather than a pasted key. Tokens are ordinary API keys of
 * kind "mcp", so they appear on the Integrations page and can be revoked there.
 *
 * Stateless transport: one McpServer per request, which keeps horizontal scaling simple.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { and, eq, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../config/database.js';
import { getEnv } from '../config/env.js';
import { accounts, apiKeys, oauthClients, oauthCodes, users } from '../db/schema/index.js';
import { generateApiKey, parseApiKey, verifyApiKey } from '../shared/api-key.js';
import type { Ctx } from '../shared/context.js';
import { API_SCOPES } from '@spv4/shared-types';
import { verifyPassword } from '../shared/password.js';
import { audit } from '../shared/audit.js';
import { registerTools } from './tools.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

async function ctxFromBearer(req: FastifyRequest): Promise<Ctx | null> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const parsed = parseApiKey(token);
  if (!parsed) return null;
  const db = getDb();
  const [row] = await db.select().from(apiKeys).where(and(eq(apiKeys.prefix, parsed.prefix), isNull(apiKeys.revokedAt))).limit(1);
  if (!row || !verifyApiKey(parsed.secret, row.keyHash)) return null;
  const [acct] = await db.select({ status: accounts.status }).from(accounts).where(eq(accounts.id, row.accountId)).limit(1);
  if (!acct || acct.status === 'CLOSED') return null;
  void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id)).catch(() => undefined);
  const clientName = (req.headers['user-agent'] as string | undefined)?.slice(0, 60) ?? row.clientName ?? 'mcp';
  return { accountId: row.accountId, actorKind: 'mcp', actorId: row.id, actorName: row.name, clientName: row.clientName ?? clientName, role: 'MANAGER', scopes: row.scopes };
}

export async function mcpRoutes(app: FastifyInstance) {
  const env = getEnv();
  const db = getDb();
  const issuer = env.API_ORIGIN.replace(/\/+$/, '');
  const resource = `${issuer}/mcp`;

  // Raw body for the MCP transport: Fastify has already parsed JSON, which the SDK accepts as parsedBody.
  const handle = async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = await ctxFromBearer(req);
    if (!ctx) {
      return reply.status(401).header('WWW-Authenticate', `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource"`).send({ error: 'unauthorized', message: 'Connect with OAuth or a Smooth Parcel MCP key' });
    }
    const server = new McpServer({ name: 'smooth-parcel', version: '4.0.0' }, { capabilities: { tools: {} } });
    registerTools(server, ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    reply.raw.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  };
  app.post('/mcp', handle);
  app.get('/mcp', handle);
  app.delete('/mcp', handle);

  // ---- OAuth 2.1 discovery ----
  app.get('/.well-known/oauth-protected-resource', async () => ({ resource, authorization_servers: [issuer], bearer_methods_supported: ['header'], scopes_supported: [...API_SCOPES] }));
  app.get('/.well-known/oauth-protected-resource/mcp', async () => ({ resource, authorization_servers: [issuer], bearer_methods_supported: ['header'], scopes_supported: [...API_SCOPES] }));
  app.get('/.well-known/oauth-authorization-server', async () => ({
    issuer, authorization_endpoint: `${issuer}/mcp/oauth/authorize`, token_endpoint: `${issuer}/mcp/oauth/token`, registration_endpoint: `${issuer}/mcp/oauth/register`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: [...API_SCOPES],
  }));

  app.post('/mcp/oauth/register', async (req, reply) => {
    const input = z.object({ client_name: z.string().max(200).optional(), redirect_uris: z.array(z.string().url()).min(1) }).parse(req.body);
    const clientId = randomBytes(16).toString('hex');
    await db.insert(oauthClients).values({ clientId, clientName: input.client_name ?? null, redirectUris: input.redirect_uris });
    return reply.status(201).send({ client_id: clientId, client_name: input.client_name, redirect_uris: input.redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] });
  });

  const authorizeQuery = z.object({ client_id: z.string(), redirect_uri: z.string().url(), response_type: z.literal('code'), state: z.string().optional(), code_challenge: z.string().min(20), code_challenge_method: z.literal('S256'), scope: z.string().optional() });

  app.get('/mcp/oauth/authorize', async (req, reply) => {
    const q = authorizeQuery.safeParse(req.query);
    if (!q.success) return reply.status(400).type('text/html').send(`<p>Invalid authorisation request: ${esc(q.error.issues.map((i) => i.path.join('.')).join(', '))}</p>`);
    const [client] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, q.data.client_id)).limit(1);
    if (!client || !client.redirectUris.includes(q.data.redirect_uri)) return reply.status(400).type('text/html').send('<p>Unknown client or redirect URI</p>');
    return reply.type('text/html').send(loginPage(q.data, client.clientName ?? 'An MCP client', null));
  });

  app.post('/mcp/oauth/authorize', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = req.body as Record<string, string>;
    const q = authorizeQuery.safeParse(body);
    if (!q.success) return reply.status(400).type('text/html').send('<p>Invalid request</p>');
    const [client] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, q.data.client_id)).limit(1);
    if (!client || !client.redirectUris.includes(q.data.redirect_uri)) return reply.status(400).type('text/html').send('<p>Unknown client</p>');
    const [u] = await db.select().from(users).where(and(eq(users.email, String(body.email ?? '').toLowerCase().trim()), isNull(users.deletedAt))).limit(1);
    if (!u || !u.passwordHash || !(await verifyPassword(u.passwordHash, String(body.password ?? '')))) {
      return reply.status(401).type('text/html').send(loginPage(q.data, client.clientName ?? 'An MCP client', 'Email or password is wrong'));
    }
    if (u.role === 'READ_ONLY') return reply.status(403).type('text/html').send(loginPage(q.data, client.clientName ?? 'An MCP client', 'Read-only users cannot connect an assistant; ask a manager'));
    const code = randomBytes(32).toString('hex');
    await db.insert(oauthCodes).values({ code, clientId: client.clientId, accountId: u.accountId, userId: u.id, redirectUri: q.data.redirect_uri, codeChallenge: q.data.code_challenge, scope: q.data.scope ?? null, expiresAt: new Date(Date.now() + 10 * 60_000) });
    const url = new URL(q.data.redirect_uri);
    url.searchParams.set('code', code);
    if (q.data.state) url.searchParams.set('state', q.data.state);
    return reply.redirect(url.toString(), 302);
  });

  app.post('/mcp/oauth/token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ grant_type: z.literal('authorization_code'), code: z.string(), redirect_uri: z.string().url(), client_id: z.string(), code_verifier: z.string().min(20) }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'invalid_request' });
    const [row] = await db.select().from(oauthCodes).where(eq(oauthCodes.code, body.data.code)).limit(1);
    if (!row || row.usedAt || row.expiresAt < new Date() || row.clientId !== body.data.client_id || row.redirectUri !== body.data.redirect_uri) return reply.status(400).send({ error: 'invalid_grant' });
    const challenge = createHash('sha256').update(body.data.code_verifier).digest('base64url');
    if (challenge !== row.codeChallenge) return reply.status(400).send({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    await db.update(oauthCodes).set({ usedAt: new Date() }).where(eq(oauthCodes.code, row.code));
    const [client] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, row.clientId)).limit(1);
    const [u] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    const gen = generateApiKey();
    const clientName = (client?.clientName ?? 'MCP client').slice(0, 120);
    const [key] = await db.insert(apiKeys).values({ accountId: row.accountId, name: `${clientName} (${u?.email ?? 'user'})`.slice(0, 120), prefix: gen.prefix, keyHash: gen.hash, scopes: [...API_SCOPES], kind: 'mcp', clientName }).returning();
    const ctx: Ctx = { accountId: row.accountId, actorKind: 'user', actorId: row.userId, actorName: u?.name ?? null, clientName: 'oauth', role: (u?.role ?? 'MANAGER') as Ctx['role'], scopes: ['*'] };
    await audit(ctx, { action: 'mcp.connected', entityType: 'api_key', entityId: key!.id, after: { client: clientName } });
    return { access_token: gen.raw, token_type: 'bearer', expires_in: 365 * 86_400, scope: API_SCOPES.join(' ') };
  });
}

function loginPage(q: { client_id: string; redirect_uri: string; state?: string; code_challenge: string; code_challenge_method: string; scope?: string }, clientName: string, error: string | null): string {
  const hidden = Object.entries({ ...q, response_type: 'code' }).filter(([, v]) => v !== undefined).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(String(v))}">`).join('');
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect ${esc(clientName)} to Smooth Parcel</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#f5f4f0;color:#15161a;margin:0}main{max-width:420px;margin:48px auto;padding:0 16px}.card{background:#fff;border:1px solid #c7ccd1;padding:24px}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 16px;color:#6b6e76}label{display:block;margin:12px 0 4px}input[type=email],input[type=password]{width:100%;box-sizing:border-box;padding:10px;border:1px solid #c7ccd1}button{margin-top:16px;width:100%;background:#3B5266;color:#fff;border:0;padding:12px;font-size:16px;cursor:pointer}.err{color:#b3261e;margin:8px 0 0}</style></head>
<body><main><div class="card"><h1>Connect ${esc(clientName)}</h1><p>Sign in to Smooth Parcel to let <strong>${esc(clientName)}</strong> create shipments, fetch labels, check tracking and update products and shipping costs on your account. You can disconnect it at any time from Integrations.</p>
<form method="post" action="/mcp/oauth/authorize">${hidden}<label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="username"><label for="password">Password</label><input id="password" name="password" type="password" required autocomplete="current-password">${error ? `<p class="err">${esc(error)}</p>` : ''}<button type="submit">Allow access</button></form></div></main></body></html>`;
}
