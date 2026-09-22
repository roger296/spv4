import type { ProblemKind } from '@spv4/shared-types';

/** Short British phrases for each problem kind, for badges and list rows. */
export const PROBLEM_PHRASES: Record<ProblemKind, string> = {
  no_scan: 'Not collected',
  delivery_failed: 'Delivery failed',
  address_failed: 'Address failed check',
  customs_incomplete: 'Customs incomplete',
  no_method: 'No method fits',
  label_failed: 'Label failed',
  courier_error: 'Courier error',
  stalled: 'No movement',
  late: 'Late',
  held: 'Held',
  returning: 'Returning to sender',
  damaged_lost: 'Damaged or lost',
  customer_reported: 'Customer reported',
};

/** The phrase for a kind; an unknown kind is tidied rather than shown raw. */
export function problemPhrase(kind: string | null | undefined): string {
  if (!kind) return 'Problem';
  const known = PROBLEM_PHRASES[kind as ProblemKind];
  if (known) return known;
  const tidy = kind.replace(/_/g, ' ').trim();
  return tidy.charAt(0).toUpperCase() + tidy.slice(1);
}
