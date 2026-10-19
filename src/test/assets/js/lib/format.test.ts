import { describe, expect, it } from 'vitest';

import {
  counter,
  date,
  dateTime,
  duration,
  elapsed,
  relativeTime,
  shortUser,
} from '../../../../main/resources/assets/js/lib/format';

describe('duration', () => {
  it.each([
    [840, '840 ms'],
    [999.7, '1.0 s'],
    [1710, '1.7 s'],
    [59_940, '59.9 s'],
    [59_999, '1 min'],
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

describe('elapsed', () => {
  it.each([
    ['2026-09-10T09:00:00Z', '2026-09-10T09:00:01.500Z', '1.5 s'],
    ['2026-09-10T09:00:00Z', null, undefined],
    ['2026-09-10T09:00:05Z', '2026-09-10T09:00:00Z', undefined],
    ['not a date', '2026-09-10T09:00:00Z', undefined],
  ])('should say %s to %s as %s', (start, end, words) => {
    expect(elapsed(start, end)).toBe(words);
  });
});

describe('dateTime and date', () => {
  it('should format a timestamp in the locale', () => {
    expect(dateTime('2026-09-10T09:05:00', 'en-US')).toBe('Sep 10, 2026, 9:05 AM');
    expect(date('2026-09-10T09:05:00', 'en-US')).toBe('Sep 10, 2026');
  });

  it('should return a value that is not a date as it is', () => {
    expect(dateTime('soon', 'en-US')).toBe('soon');
    expect(date('soon', 'en-US')).toBe('soon');
  });
});

describe('counter', () => {
  it.each([
    [0, '0 s'],
    [4999, '4 s'],
    [59_999, '59 s'],
    [60_000, '1 min'],
    [65_400, '1 min 5 s'],
    [119_999, '1 min 59 s'],
  ])('should count %d ms in whole seconds as %s', (ms, expected) => {
    expect(counter(ms)).toBe(expected);
  });
});
