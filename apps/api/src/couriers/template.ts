/**
 * Template rendering for courier profiles.
 *
 *   "{{ order.contactName | upper | truncate:35 }}"   → string with filters applied
 *   "{{ parcel.weightKg | grams }}"                    → the number 1300 (whole-expression keeps type)
 *   { "$map": "order.lines", "as": "line", "item": { "sku": "{{ line.sku }}" } }  → array
 *   { "$if": "order.international", "then": {...}, "else": {...} }
 *   { "field": "...", "$omitIf": "order.domestic" }   → object omitted when condition truthy
 *   Keys ending in "?" are dropped when their rendered value is null/undefined/"".
 */
import { toAlpha2 } from '../shared/countries.js';

export type TemplateContext = Record<string, unknown>;

const EXPR = /\{\{\s*([^}]+?)\s*\}\}/g;

export function getPath(obj: unknown, path: string): unknown {
  if (path === '' || path === '$' || path === '.') return obj;
  const clean = path.replace(/^\$\.?/, '');
  const parts = clean.split(/\.|\[|\]\.?/).filter((p) => p !== '');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur) && /^-?\d+$/.test(part)) {
      const idx = Number(part);
      cur = cur[idx < 0 ? cur.length + idx : idx];
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[part];
    } else return undefined;
  }
  return cur;
}

const ALPHA3: Record<string, string> = { GB: 'GBR', IE: 'IRL', FR: 'FRA', DE: 'DEU', ES: 'ESP', IT: 'ITA', NL: 'NLD', BE: 'BEL', PT: 'PRT', AT: 'AUT', DK: 'DNK', SE: 'SWE', FI: 'FIN', PL: 'POL', LU: 'LUX', US: 'USA', CA: 'CAN', AU: 'AUS', NZ: 'NZL', CH: 'CHE', NO: 'NOR', JP: 'JPN', CN: 'CHN', HK: 'HKG', SG: 'SGP', AE: 'ARE', IN: 'IND', PK: 'PAK', ZA: 'ZAF', BR: 'BRA', MX: 'MEX', CZ: 'CZE', HU: 'HUN', RO: 'ROU', GR: 'GRC', HR: 'HRV', SK: 'SVK', SI: 'SVN', BG: 'BGR', LT: 'LTU', LV: 'LVA', EE: 'EST', MT: 'MLT', CY: 'CYP', IS: 'ISL', TR: 'TUR', IL: 'ISR', KR: 'KOR', JE: 'JEY', GG: 'GGY', IM: 'IMN', GI: 'GIB' };

type Filter = (value: unknown, arg: string | undefined, ctx: TemplateContext) => unknown;

const FILTERS: Record<string, Filter> = {
  upper: (v) => (v == null ? v : String(v).toUpperCase()),
  lower: (v) => (v == null ? v : String(v).toLowerCase()),
  trim: (v) => (v == null ? v : String(v).trim()),
  truncate: (v, arg) => (v == null ? v : String(v).slice(0, Number(arg ?? 35))),
  default: (v, arg) => (v === undefined || v === null || v === '' ? parseLiteral(arg) : v),
  number: (v) => (v == null || v === '' ? null : Number(v)),
  int: (v) => (v == null || v === '' ? null : Math.round(Number(v))),
  round: (v, arg) => (v == null ? v : Number(Number(v).toFixed(Number(arg ?? 2)))),
  grams: (v) => (v == null ? v : Math.round(Number(v) * 1000)),
  kg: (v) => (v == null ? v : Number(Number(v).toFixed(3))),
  mm: (v) => (v == null ? v : Math.round(Number(v) * 10)),
  cm: (v) => (v == null ? v : Number(Number(v).toFixed(1))),
  inches: (v) => (v == null ? v : Number((Number(v) / 2.54).toFixed(2))),
  lbs: (v) => (v == null ? v : Number((Number(v) * 2.20462).toFixed(3))),
  pence: (v) => (v == null ? v : Math.round(Number(v) * 100)),
  bool: (v) => !!v && v !== 'false' && v !== '0',
  not: (v) => !v,
  string: (v) => (v == null ? '' : String(v)),
  json: (v) => JSON.stringify(v),
  date: (v, arg) => formatDate(v, arg ?? 'YYYY-MM-DD'),
  iso: (v) => (v == null ? new Date().toISOString() : new Date(String(v)).toISOString()),
  alpha2: (v) => (v == null ? v : toAlpha2(String(v))),
  alpha3: (v) => (v == null ? v : ALPHA3[String(v).toUpperCase()] ?? String(v).toUpperCase()),
  first_name: (v) => (v == null ? v : splitName(String(v)).first),
  last_name: (v) => (v == null ? v : splitName(String(v)).last),
  concat: (v, arg) => `${v ?? ''}${parseLiteral(arg) ?? ''}`,
  prepend: (v, arg) => `${parseLiteral(arg) ?? ''}${v ?? ''}`,
  digits: (v) => (v == null ? v : String(v).replace(/\D+/g, '')),
  nospace: (v) => (v == null ? v : String(v).replace(/\s+/g, '')),
  length: (v) => (Array.isArray(v) ? v.length : v == null ? 0 : String(v).length),
  sum: (v, arg) => (Array.isArray(v) ? v.reduce((a: number, x) => a + Number(getPath(x, arg ?? '') ?? 0), 0) : 0),
  join: (v, arg) => (Array.isArray(v) ? v.join(parseLiteral(arg) as string ?? ',') : v),
  eq: (v, arg) => v == parseLiteral(arg), // eslint-disable-line eqeqeq
  base64: (v) => (v == null ? v : Buffer.from(String(v), 'utf8').toString('base64')),
  urlencode: (v) => (v == null ? v : encodeURIComponent(String(v))),
};

function parseLiteral(arg: string | undefined): unknown {
  if (arg === undefined) return undefined;
  const t = arg.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) return t.slice(1, -1);
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0]!, last: parts[0]! };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1]! };
}

function formatDate(v: unknown, fmt: string): string {
  const d = v == null || v === 'now' ? new Date() : new Date(String(v));
  const pad = (n: number) => String(n).padStart(2, '0');
  return fmt
    .replace('YYYY', String(d.getUTCFullYear()))
    .replace('MM', pad(d.getUTCMonth() + 1))
    .replace('DD', pad(d.getUTCDate()))
    .replace('HH', pad(d.getUTCHours()))
    .replace('mm', pad(d.getUTCMinutes()))
    .replace('ss', pad(d.getUTCSeconds()));
}

/** Evaluate one `path | filter | filter:arg` expression. */
export function evaluate(expr: string, ctx: TemplateContext): unknown {
  const [head, ...pipes] = expr.split('|').map((s) => s.trim());
  let value: unknown;
  if (head === undefined || head === '') value = undefined;
  else if ((head.startsWith("'") && head.endsWith("'")) || (head.startsWith('"') && head.endsWith('"'))) value = head.slice(1, -1);
  else if (/^-?\d+(\.\d+)?$/.test(head)) value = Number(head);
  else if (head === 'true' || head === 'false') value = head === 'true';
  else value = getPath(ctx, head);
  for (const pipe of pipes) {
    const idx = pipe.indexOf(':');
    const name = idx === -1 ? pipe : pipe.slice(0, idx);
    const arg = idx === -1 ? undefined : pipe.slice(idx + 1);
    const fn = FILTERS[name.trim()];
    if (!fn) throw new Error(`Unknown template filter "${name}"`);
    value = fn(value, arg, ctx);
  }
  return value;
}

export function renderString(template: string, ctx: TemplateContext): unknown {
  const whole = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(template.trim());
  if (whole) return evaluate(whole[1]!, ctx);
  return template.replace(EXPR, (_, expr: string) => {
    const v = evaluate(expr, ctx);
    return v === undefined || v === null ? '' : String(v);
  });
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return !!v && v !== 'false' && v !== '0';
}

/** Render any JSON-like template value. */
export function render(template: unknown, ctx: TemplateContext): unknown {
  if (typeof template === 'string') return renderString(template, ctx);
  if (Array.isArray(template)) return template.map((t) => render(t, ctx)).filter((v) => v !== undefined);
  if (template && typeof template === 'object') {
    const obj = template as Record<string, unknown>;
    if (typeof obj.$map === 'string') {
      const list = getPath(ctx, obj.$map) ?? evaluate(obj.$map, ctx);
      const as = typeof obj.as === 'string' ? obj.as : 'item';
      if (!Array.isArray(list)) return [];
      return list.map((item, index) => render(obj.item, { ...ctx, [as]: item, index, position: index + 1 }));
    }
    if (typeof obj.$if === 'string') {
      const cond = truthy(evaluate(obj.$if, ctx));
      return cond ? render(obj.then, ctx) : obj.else === undefined ? undefined : render(obj.else, ctx);
    }
    if (typeof obj.$omitIf === 'string' && truthy(evaluate(obj.$omitIf, ctx))) return undefined;
    if (typeof obj.$includeIf === 'string' && !truthy(evaluate(obj.$includeIf, ctx))) return undefined;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === '$omitIf' || key === '$includeIf') continue;
      const optional = key.endsWith('?');
      const name = optional ? key.slice(0, -1) : key;
      const rendered = render(value, ctx);
      if (rendered === undefined) continue;
      if (optional && (rendered === null || rendered === '')) continue;
      out[name] = rendered;
    }
    return out;
  }
  return template;
}
