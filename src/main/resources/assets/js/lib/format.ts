const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function relativeTime(iso: string, locale: string, now: number = Date.now()): string {
  const seconds = (Date.parse(iso) - now) / 1000;
  if (Number.isNaN(seconds)) return iso;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'second');
}

function absolute(iso: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function dateTime(iso: string, locale: string): string {
  return absolute(iso, locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export function date(iso: string, locale: string): string {
  return absolute(iso, locale, { dateStyle: 'medium' });
}

export function duration(ms: number): string {
  // Compared after rounding, so 999.7 ms is not "1000 ms" and 59,990 ms is not "60.0 s".
  if (Math.round(ms) < 1000) return `${Math.round(ms)} ms`;
  if (Math.round(ms / 100) < 600) return `${(ms / 1000).toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

export function elapsed(startedAt: string, finishedAt: string | null): string | undefined {
  if (finishedAt == null) return undefined;
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isNaN(ms) || ms < 0 ? undefined : duration(ms);
}

// `user:system:su` reads as `su`; keys from other ID providers keep the provider.
export function shortUser(key: string): string {
  const [type, idProvider, ...login] = key.split(':');
  if (type !== 'user' || login.length === 0) return key;
  return idProvider === 'system' ? login.join(':') : `${login.join(':')} (${idProvider})`;
}

export function counter(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return seconds < 60 ? `${seconds} s` : duration(seconds * 1000);
}
