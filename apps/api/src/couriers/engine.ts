/**
 * The connector engine: the only code that talks to couriers. It renders a profile's
 * operation template, applies the profile's authentication, calls the courier, and maps
 * the reply. Courier accounts carry the credentials; login-exchange sessions are cached.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../config/database.js';
import { courierAccounts } from '../db/schema/index.js';
import { decrypt, decryptJson, encrypt } from '../shared/crypto.js';
import { CourierRejectedError } from '../shared/errors.js';
import { getPath, render, renderString, type TemplateContext } from './template.js';
import type { OperationName, OperationSpec, ProfileDefinition } from './profile-schema.js';

export interface EngineAccount {
  id: string;
  credentials: Record<string, string>;
  sandbox: boolean;
  session?: { token: string; expiresAt: Date } | null;
}

export interface CallResult {
  ok: boolean;
  status: number;
  body: unknown;
  text: string;
  headers: Record<string, string>;
  request: { method: string; url: string; headers: Record<string, string>; body?: string };
  message?: string;
  durationMs: number;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike = (url, init) => fetch(url, init);
export function setFetchForTests(fn: FetchLike | null): void { fetchImpl = fn ?? ((url, init) => fetch(url, init)); }

const REDACT = /(authorization|password|apikey|api_key|token|secret|geosession)/i;
export function redactHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k] = REDACT.test(k) ? `${v.slice(0, 4)}…` : v;
  return out;
}

export class ConnectorEngine {
  constructor(private def: ProfileDefinition, private account: EngineAccount) {}

  baseUrl(): string {
    return (this.account.sandbox && this.def.sandboxBaseUrl ? this.def.sandboxBaseUrl : this.def.baseUrl).replace(/\/+$/, '');
  }

  private baseContext(extra: TemplateContext): TemplateContext {
    return { cred: this.account.credentials, sandbox: this.account.sandbox, now: new Date().toISOString(), session: { token: this.account.session?.token ?? '' }, ...extra };
  }

  /** Obtain or refresh a login-exchange session. */
  private async ensureSession(force = false): Promise<void> {
    const auth = this.def.auth;
    if (auth.kind !== 'login') return;
    const valid = this.account.session && this.account.session.expiresAt > new Date(Date.now() + 60_000);
    if (valid && !force) return;
    const ctx = this.baseContext({});
    const headers: Record<string, string> = this.staticHeaders(ctx);
    if (auth.basic) {
      const u = String(renderString(auth.basic.username, ctx) ?? '');
      const p = String(renderString(auth.basic.password, ctx) ?? '');
      headers.Authorization = `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
    }
    const res = await this.rawCall(auth.request, ctx, headers);
    if (!res.ok) throw new CourierRejectedError(`Courier login failed: ${res.message ?? res.status}`, false, { status: res.status });
    const token = getPath(res.body, auth.tokenPath);
    if (!token) throw new CourierRejectedError(`Courier login reply had no token at ${auth.tokenPath}`, false);
    const expiresAt = new Date(Date.now() + auth.ttlMinutes * 60_000);
    this.account.session = { token: String(token), expiresAt };
    await getDb().update(courierAccounts).set({ sessionEnc: encrypt(String(token)), sessionExpiresAt: expiresAt }).where(eq(courierAccounts.id, this.account.id)).catch(() => undefined);
  }

  /** Profile-level headers are templates too (e.g. DPD's GeoClient: account/{{ cred.accountNumber }}). */
  private staticHeaders(ctx: TemplateContext): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.def.headers ?? {})) out[k] = String(renderString(v, ctx) ?? '');
    return out;
  }

  private authHeaders(ctx: TemplateContext): Record<string, string> {
    const auth = this.def.auth;
    switch (auth.kind) {
      case 'none': return {};
      case 'header': return { [auth.header]: String(renderString(auth.value, ctx) ?? '') };
      case 'basic': {
        const u = String(renderString(auth.username, ctx) ?? '');
        const p = String(renderString(auth.password, ctx) ?? '');
        return { Authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` };
      }
      case 'bearer': return { Authorization: `Bearer ${String(renderString(auth.token, ctx) ?? '')}` };
      case 'login': return { [auth.header]: `${auth.prefix}${this.account.session?.token ?? ''}` };
    }
  }

  private async rawCall(op: OperationSpec, ctx: TemplateContext, extraHeaders: Record<string, string>): Promise<CallResult> {
    const path = String(renderString(op.path, ctx) ?? '');
    const url = new URL(path.startsWith('http') ? path : `${this.baseUrl()}/${path.replace(/^\/+/, '')}`);
    for (const [k, v] of Object.entries(op.query ?? {})) {
      const val = renderString(v, ctx);
      if (val !== undefined && val !== null && val !== '') url.searchParams.set(k, String(val));
    }
    const headers: Record<string, string> = { Accept: 'application/json, application/pdf, */*', ...extraHeaders };
    for (const [k, v] of Object.entries(op.headers ?? {})) headers[k] = String(renderString(v, ctx) ?? '');
    let body: string | undefined;
    if (op.body !== undefined && op.method !== 'GET') {
      const rendered = render(op.body, ctx);
      if (op.contentType === 'form') {
        headers['Content-Type'] ??= 'application/x-www-form-urlencoded';
        body = new URLSearchParams(Object.entries(rendered as Record<string, string>).map(([k, v]) => [k, String(v)])).toString();
      } else if (op.contentType === 'xml') {
        headers['Content-Type'] ??= 'application/xml';
        body = typeof rendered === 'string' ? rendered : String(rendered);
      } else if (op.contentType !== 'none') {
        headers['Content-Type'] ??= 'application/json';
        body = JSON.stringify(rendered);
      }
    }
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.def.timeoutMs);
    try {
      const res = await fetchImpl(url.toString(), { method: op.method, headers, body, signal: controller.signal });
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { resHeaders[k] = v; });
      let text = '';
      let parsed: unknown = null;
      const ct = res.headers.get('content-type') ?? '';
      if (op.responseType === 'binary' || ct.includes('application/pdf') || ct.includes('image/')) {
        const buf = Buffer.from(await res.arrayBuffer());
        parsed = { base64: buf.toString('base64'), contentType: ct, bytes: buf.length };
        text = `<${buf.length} bytes ${ct}>`;
      } else {
        text = await res.text();
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
      }
      const okCode = op.successCodes ? op.successCodes.includes(res.status) : res.status >= 200 && res.status < 300;
      let ok = okCode;
      if (ok && op.successWhen) {
        const v = getPath(parsed, op.successWhen.path);
        ok = op.successWhen.equals !== undefined ? v === op.successWhen.equals : !!v;
      }
      const message = !ok ? extractMessage(parsed, text, op.errorPath, res.status) : undefined;
      return { ok, status: res.status, body: parsed, text, headers: resHeaders, request: { method: op.method, url: url.toString(), headers: redactHeaders(headers), body: body?.slice(0, 20_000) }, message, durationMs: Date.now() - started };
    } catch (err) {
      const message = (err as Error).name === 'AbortError' ? `Courier did not answer within ${this.def.timeoutMs} ms` : `Could not reach courier: ${(err as Error).message}`;
      return { ok: false, status: 0, body: null, text: '', headers: {}, request: { method: op.method, url: url.toString(), headers: redactHeaders(headers), body }, message, durationMs: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Run a named operation with the given context. Handles auth and one 401 retry. */
  async run(name: OperationName, context: TemplateContext): Promise<CallResult> {
    const op = this.def.operations[name] as OperationSpec | undefined;
    if (!op) throw new CourierRejectedError(`This courier profile has no ${name} operation`, false);
    await this.ensureSession();
    const ctx = this.baseContext(context);
    const headers = { ...this.staticHeaders(ctx), ...this.authHeaders(ctx) };
    let res = await this.rawCall(op, ctx, headers);
    if (res.status === 401 && this.def.auth.kind === 'login' && this.def.auth.retryOn401) {
      await this.ensureSession(true);
      const ctx2 = this.baseContext(context);
      res = await this.rawCall(op, ctx2, { ...this.staticHeaders(ctx2), ...this.authHeaders(ctx2) });
    }
    return res;
  }

  /** True when a failed call is worth retrying later (network, 429, 5xx listed in retryOn). */
  isRetryable(res: CallResult): boolean {
    return res.status === 0 || this.def.retryOn.includes(res.status);
  }

  /** Apply the profile's status map to a courier status string. */
  mapStatus(courierStatus: string): { status: 'LABEL_GENERATED' | 'SHIPPED' | 'IN_TRANSIT' | 'DELIVERED' | 'PROBLEM'; problem?: string } | null {
    const s = courierStatus.trim().toLowerCase();
    for (const entry of this.def.statusMap) {
      const m = entry.match.toLowerCase();
      let hit = false;
      if (m.startsWith('re:')) hit = new RegExp(m.slice(3), 'i').test(courierStatus);
      else if (m.endsWith('*')) hit = s.startsWith(m.slice(0, -1));
      else hit = s === m;
      if (hit) return { status: entry.status, problem: entry.problem };
    }
    return null;
  }
}

function extractMessage(body: unknown, text: string, errorPath: string | undefined, status: number): string {
  if (errorPath) {
    const v = getPath(body, errorPath);
    if (v) return typeof v === 'string' ? v : JSON.stringify(v);
  }
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    for (const k of ['message', 'Message', 'error', 'errorMessage', 'error_description', 'detail', 'title']) {
      const v = o[k];
      if (typeof v === 'string' && v) return v;
      if (v && typeof v === 'object') return JSON.stringify(v).slice(0, 500);
    }
    if (Array.isArray(o.errors) && o.errors.length) return JSON.stringify(o.errors).slice(0, 500);
  }
  return text ? text.slice(0, 300) : `HTTP ${status}`;
}

/** Load a courier account's decrypted credentials and cached session. */
export async function loadEngineAccount(row: typeof courierAccounts.$inferSelect): Promise<EngineAccount> {
  const credentials = row.credentialsEnc ? decryptJson<Record<string, string>>(row.credentialsEnc) : {};
  const session = row.sessionEnc && row.sessionExpiresAt ? { token: decrypt(row.sessionEnc), expiresAt: row.sessionExpiresAt } : null;
  return { id: row.id, credentials, sandbox: row.sandbox, session };
}
