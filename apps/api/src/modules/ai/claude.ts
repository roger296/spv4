/**
 * Thin Anthropic Messages API client with a per-account daily budget (spec section 11).
 * No SDK dependency: one fetch call. Prompts live in the repository so behaviour is reviewable.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '../../config/database.js';
import { getEnv } from '../../config/env.js';
import { aiUsage } from '../../db/schema/index.js';
import { AppError } from '../../shared/errors.js';

export interface ClaudeCall {
  accountId: string | null;
  job: string;
  system: string;
  user: string;
  maxTokens?: number;
  json?: boolean;
}

export interface ClaudeResult { text: string; inputTokens: number; outputTokens: number; costGbp: number }

// Approximate GBP per million tokens; adjust when pricing changes.
const PRICE: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 2.4, output: 12 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
  'claude-opus-5': { input: 12, output: 60 },
};

export function isAiConfigured(): boolean {
  return !!getEnv().ANTHROPIC_API_KEY;
}

export async function spentTodayGbp(accountId: string | null): Promise<number> {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const rows = await getDb().select({ sum: sql<string>`coalesce(sum(${aiUsage.costGbp}), 0)` }).from(aiUsage)
    .where(and(accountId ? eq(aiUsage.accountId, accountId) : sql`true`, gte(aiUsage.createdAt, since)));
  return Number(rows[0]?.sum ?? 0);
}

export type ClaudeTransport = (body: Record<string, unknown>) => Promise<{ content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number } }>;
let transport: ClaudeTransport | null = null;
export function setClaudeTransportForTests(fn: ClaudeTransport | null): void { transport = fn; }

export async function askClaude(call: ClaudeCall): Promise<ClaudeResult> {
  const env = getEnv();
  if (!transport && !env.ANTHROPIC_API_KEY) throw new AppError(503, 'ai_unavailable', 'AI features need ANTHROPIC_API_KEY to be set');
  const spent = await spentTodayGbp(call.accountId);
  if (spent >= env.AI_DAILY_BUDGET_GBP) throw new AppError(429, 'ai_budget', `Today's AI budget of £${env.AI_DAILY_BUDGET_GBP} is used up`);
  const model = env.ANTHROPIC_MODEL;
  const body = {
    model, max_tokens: call.maxTokens ?? 4096, system: call.system,
    messages: [{ role: 'user', content: call.user }],
  };
  let data: Awaited<ReturnType<ClaudeTransport>>;
  if (transport) data = await transport(body);
  else {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new AppError(502, 'ai_error', `Claude API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    data = (await res.json()) as Awaited<ReturnType<ClaudeTransport>>;
  }
  const text = data.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  const price = PRICE[model] ?? PRICE['claude-sonnet-5']!;
  const costGbp = (data.usage.input_tokens * price.input + data.usage.output_tokens * price.output) / 1_000_000;
  await getDb().insert(aiUsage).values({ accountId: call.accountId, job: call.job, model, inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens, costGbp: costGbp.toFixed(4) });
  return { text, inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens, costGbp };
}

/** Pull the first JSON object or array out of a model reply. */
export function extractJson<T = unknown>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  const start = Math.min(...['{', '['].map((c) => { const i = candidate.indexOf(c); return i === -1 ? Infinity : i; }));
  if (!Number.isFinite(start)) throw new AppError(502, 'ai_error', 'The model reply contained no JSON');
  const slice = candidate.slice(start);
  const end = Math.max(slice.lastIndexOf('}'), slice.lastIndexOf(']'));
  return JSON.parse(slice.slice(0, end + 1)) as T;
}
