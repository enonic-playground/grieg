import { describe, expect, it } from 'vitest';

import { duration, relativeTime, shortUser } from '../../../main/resources/assets/ui/format';

describe('duration', () => {
  it.each([
    [840, '840 ms'],
    [1710, '1.7 s'],
    [60_000, '1 min'],
    [119_999, '2 min'],
    [125_400, '2 min 5 s'],
  ])('should say %i ms as "%s"', (ms, words) => {
    expect(duration(ms)).toBe(words);
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-09-12T12:00:00Z');

  it.each([
    ['2026-09-12T11:59:30Z', 'now'],
    ['2026-09-12T11:55:00Z', '5 minutes ago'],
    ['2026-09-11T12:00:00Z', 'yesterday'],
    ['not a date', 'not a date'],
  ])('should say %s as "%s"', (iso, words) => {
    expect(relativeTime(iso, 'en-US', now)).toBe(words);
  });
});

describe('shortUser', () => {
  it.each([
    ['user:system:su', 'su'],
    ['user:ldap:alice', 'alice (ldap)'],
    ['role:system.admin', 'role:system.admin'],
  ])('should say %s as "%s"', (key, words) => {
    expect(shortUser(key)).toBe(words);
  });
});
