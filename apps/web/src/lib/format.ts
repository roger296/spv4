import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';

const CURRENCY_SYMBOLS: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' };

export function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isNaN(n) ? null : n;
}

export function formatMoney(value: number | string | null | undefined, currency = 'GBP'): string {
  const n = num(value);
  if (n === null) return '—';
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return `${symbol}${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function toDate(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  try {
    const d = typeof iso === 'string' ? parseISO(iso) : iso;
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function formatDate(iso: string | Date | null | undefined): string {
  const d = toDate(iso);
  return d ? format(d, 'd MMM yyyy') : '—';
}

export function formatDateTime(iso: string | Date | null | undefined): string {
  const d = toDate(iso);
  return d ? format(d, 'd MMM yyyy HH:mm') : '—';
}

/** Compact age for list columns: "now", "5m", "3h", "2d". */
export function formatAge(iso: string | Date | null | undefined): string {
  const d = toDate(iso);
  if (!d) return '—';
  const minutes = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatRelative(iso: string | Date | null | undefined): string {
  const d = toDate(iso);
  return d ? `${formatDistanceToNowStrict(d)} ago` : '—';
}

export function formatKg(value: number | string | null | undefined): string {
  const n = num(value);
  return n === null ? '—' : `${n.toLocaleString('en-GB', { maximumFractionDigits: 3 })} kg`;
}

export function formatCm(value: number | string | null | undefined): string {
  const n = num(value);
  return n === null ? '—' : n.toLocaleString('en-GB', { maximumFractionDigits: 1 });
}

export function formatDims(l: unknown, w: unknown, h: unknown): string {
  const parts = [l, w, h].map((v) => num(v as string | number | null));
  if (parts.some((p) => p === null)) return '—';
  return `${parts.map((p) => formatCm(p)).join(' × ')} cm`;
}
