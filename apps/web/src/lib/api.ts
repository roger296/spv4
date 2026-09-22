/**
 * Typed fetch wrapper for the Smooth Parcel V4 API.
 *
 * Adds the bearer token, serialises JSON, and turns every failure into an
 * ApiError carrying the API's `{ error: { code, message, details } }` body.
 * Order endpoints answer 422 with a `needs_information` or `no_method` reply
 * rather than an error envelope; those become NeedsInformationError and
 * NoMethodError so pages can render the missing list.
 */
import { clearToken, getToken } from './auth';
import type { MissingField } from '@spv4/shared-types';

export const API_ORIGIN =
  (import.meta.env.VITE_API_ORIGIN as string | undefined)?.replace(/\/+$/, '') ??
  'http://127.0.0.1:3100';
export const API_BASE = `${API_ORIGIN}/v4`;
export const MCP_ORIGIN =
  (import.meta.env.VITE_MCP_ORIGIN as string | undefined) ?? 'http://127.0.0.1:3100/mcp';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(message: string, status: number, code = 'error', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** The endpoint does not exist on this API build yet (a route-level 404). */
  get notAvailable(): boolean {
    return this.status === 404 && this.code !== 'not_found';
  }
}

export interface NeedsInformationBody {
  status: 'needs_information';
  reference: string;
  orderStatus?: string;
  missing: MissingField[];
  resume?: string;
}

export interface NoMethodBody {
  status: 'no_method';
  reference: string;
  dropped: { name: string; reason: string }[];
}

export class NeedsInformationError extends ApiError {
  readonly body: NeedsInformationBody;
  constructor(body: NeedsInformationBody) {
    super(`Order ${body.reference} needs more information`, 422, 'needs_information', body.missing);
    this.name = 'NeedsInformationError';
    this.body = body;
  }
}

export class NoMethodError extends ApiError {
  readonly body: NoMethodBody;
  constructor(body: NoMethodBody) {
    super(`No shipping method fits order ${body.reference}`, 422, 'no_method', body.dropped);
    this.name = 'NoMethodError';
    this.body = body;
  }
}

export type SearchParams = Record<string, string | number | boolean | undefined | null>;

interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  searchParams?: SearchParams;
  /** Skip the automatic sign-out on 401 (used by the auth pages themselves). */
  keepSession?: boolean;
}

export function buildUrl(path: string, searchParams?: SearchParams): string {
  const raw = path.startsWith('http') ? path : `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const url = new URL(raw);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function authHeaders(extra?: HeadersInit): Record<string, string> {
  const token = getToken();
  return {
    Accept: 'application/json, application/pdf, text/csv',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((extra as Record<string, string> | undefined) ?? {}),
  };
}

function handleUnauthorised(keepSession?: boolean) {
  if (keepSession) return;
  clearToken();
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/sign-in')) {
    window.location.href = '/sign-in';
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Turn a non-OK response body into the right error type. */
export function errorFromBody(status: number, body: unknown): ApiError {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (b.status === 'needs_information' && Array.isArray(b.missing)) {
      return new NeedsInformationError(b as unknown as NeedsInformationBody);
    }
    if (b.status === 'no_method' && Array.isArray(b.dropped)) {
      return new NoMethodError(b as unknown as NoMethodBody);
    }
    const err = b.error as { code?: string; message?: string; details?: unknown } | undefined;
    if (err && typeof err === 'object') {
      return new ApiError(err.message ?? `Request failed (${status})`, status, err.code ?? 'error', err.details);
    }
    if (typeof b.message === 'string') return new ApiError(b.message, status, (b.code as string) ?? 'error');
  }
  if (status === 404) return new ApiError('Not available yet', 404, 'route_missing');
  return new ApiError(typeof body === 'string' && body ? body : `Request failed (${status})`, status);
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { body, searchParams, headers, keepSession, ...rest } = opts;
  const response = await fetch(buildUrl(path, searchParams), {
    ...rest,
    headers: {
      ...authHeaders(headers),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    const parsed = await readBody(response);
    handleUnauthorised(keepSession);
    throw errorFromBody(401, parsed);
  }
  if (response.status === 204) return undefined as T;
  const parsed = await readBody(response);
  if (!response.ok) throw errorFromBody(response.status, parsed);
  return parsed as T;
}

export const get = <T>(path: string, searchParams?: SearchParams) => api<T>(path, { searchParams });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T = void>(path: string) => api<T>(path, { method: 'DELETE' });

interface BinaryInit {
  method?: string;
  body?: unknown;
  searchParams?: SearchParams;
}

/** Fetch a binary document with auth and hand back the blob. */
export async function fetchBlob(path: string, init: BinaryInit = {}): Promise<Blob> {
  const response = await fetch(buildUrl(path, init.searchParams), {
    method: init.method ?? 'GET',
    headers: { ...authHeaders(), ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (response.status === 401) {
    handleUnauthorised();
    throw new ApiError('Sign in required', 401, 'unauthorized');
  }
  if (!response.ok) throw errorFromBody(response.status, await readBody(response));
  return response.blob();
}

/**
 * Open a PDF from the API in a new tab. The tab is opened straight away (so
 * pop-up blockers allow it) and pointed at the blob once it has downloaded.
 */
export async function openPdf(path: string, init: BinaryInit = {}): Promise<void> {
  const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  try {
    const blob = await fetchBlob(path, init);
    const pdf = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
    const url = URL.createObjectURL(pdf);
    if (tab) tab.location.href = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Download a document to disk under the given file name. */
export async function downloadFile(path: string, fileName: string, init: BinaryInit = {}): Promise<void> {
  const blob = await fetchBlob(path, init);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Fetch plain text (CSV templates and exports). */
export async function fetchText(path: string, searchParams?: SearchParams): Promise<string> {
  const response = await fetch(buildUrl(path, searchParams), {
    headers: authHeaders({ Accept: 'text/csv, text/plain, application/json' }),
  });
  if (response.status === 401) {
    handleUnauthorised();
    throw new ApiError('Sign in required', 401, 'unauthorized');
  }
  if (!response.ok) throw errorFromBody(response.status, await readBody(response));
  return response.text();
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

export function isNotAvailable(e: unknown): boolean {
  return e instanceof ApiError && e.notAvailable;
}
