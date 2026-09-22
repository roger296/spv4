import { describe, expect, it } from 'vitest';
import { PROBLEM_KINDS } from '@spv4/shared-types';
import { PROBLEM_PHRASES, problemPhrase } from './problem-phrases';

describe('problemPhrase', () => {
  it('has a British phrase for every kind the API can send', () => {
    for (const kind of PROBLEM_KINDS) {
      expect(PROBLEM_PHRASES[kind]).toBeTruthy();
      expect(problemPhrase(kind)).toBe(PROBLEM_PHRASES[kind]);
    }
  });

  it('maps the documented kinds to the agreed wording', () => {
    expect(problemPhrase('no_scan')).toBe('Not collected');
    expect(problemPhrase('delivery_failed')).toBe('Delivery failed');
    expect(problemPhrase('address_failed')).toBe('Address failed check');
    expect(problemPhrase('customs_incomplete')).toBe('Customs incomplete');
    expect(problemPhrase('no_method')).toBe('No method fits');
    expect(problemPhrase('label_failed')).toBe('Label failed');
    expect(problemPhrase('courier_error')).toBe('Courier error');
    expect(problemPhrase('stalled')).toBe('No movement');
    expect(problemPhrase('late')).toBe('Late');
    expect(problemPhrase('held')).toBe('Held');
    expect(problemPhrase('returning')).toBe('Returning to sender');
    expect(problemPhrase('damaged_lost')).toBe('Damaged or lost');
    expect(problemPhrase('customer_reported')).toBe('Customer reported');
  });

  it('tidies an unknown kind rather than showing the raw token', () => {
    expect(problemPhrase('weird_new_thing')).toBe('Weird new thing');
  });

  it('falls back to "Problem" when there is no kind', () => {
    expect(problemPhrase(null)).toBe('Problem');
    expect(problemPhrase(undefined)).toBe('Problem');
    expect(problemPhrase('')).toBe('Problem');
  });
});
