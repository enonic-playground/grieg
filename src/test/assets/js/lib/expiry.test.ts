import { describe, expect, it } from 'vitest';

import { getExpiry } from '../../../../main/resources/assets/js/lib/expiry';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function expiresIn(ms: number): string {
  return new Date(NOW + ms).toISOString();
}

describe('getExpiry', () => {
  it.each([
    { label: 'already past', ms: -1, expected: { expired: true, daysLeft: 0, soon: false } },
    { label: 'exactly now', ms: 0, expected: { expired: true, daysLeft: 0, soon: false } },
    { label: 'one millisecond left', ms: 1, expected: { expired: false, daysLeft: 1, soon: true } },
    {
      label: 'half a day left',
      ms: DAY_MS / 2,
      expected: { expired: false, daysLeft: 1, soon: true },
    },
    {
      label: '14 days left',
      ms: 14 * DAY_MS,
      expected: { expired: false, daysLeft: 14, soon: true },
    },
    {
      label: 'just over 14 days left',
      ms: 14 * DAY_MS + 1,
      expected: { expired: false, daysLeft: 15, soon: false },
    },
    {
      label: '39.5 days left',
      ms: 39.5 * DAY_MS,
      expected: { expired: false, daysLeft: 40, soon: false },
    },
  ])('should report $label', ({ ms, expected }) => {
    expect(getExpiry(expiresIn(ms), NOW)).toEqual(expected);
  });
});
