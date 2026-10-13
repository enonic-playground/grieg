const DAY_MS = 24 * 60 * 60 * 1000;
const WARNING_DAYS = 14;

export type Expiry = {
  expired: boolean;
  daysLeft: number;
  soon: boolean;
};

export function getExpiry(expires: string, now: number = Date.now()): Expiry {
  const msLeft = Date.parse(expires) - now;
  const expired = msLeft <= 0;
  const daysLeft = expired ? 0 : Math.ceil(msLeft / DAY_MS);
  return { expired, daysLeft, soon: !expired && daysLeft <= WARNING_DAYS };
}

export function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
}

export function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}
