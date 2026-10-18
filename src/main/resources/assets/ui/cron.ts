// Says a cron expression in words, for the forms schedules actually use. Anything else returns
// `undefined`, and the card shows the raw expression instead.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = DAYS.map((day) => day.slice(0, 3));
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MONTH_NAMES = MONTHS.map((month) => month.slice(0, 3).toUpperCase());
const DAY_NAMES = SHORT_DAYS.map((day) => day.toUpperCase());

function parseValue(token: string, min: number, max: number, names?: string[]): number | undefined {
  const named = names?.indexOf(token.toUpperCase()) ?? -1;
  const value = named >= 0 ? named + min : /^\d+$/.test(token) ? Number(token) : Number.NaN;
  return value >= min && value <= max ? value : undefined;
}

// A field of plain values, lists and ranges, e.g. `1,3-5`; undefined for steps or `*`.
function parseList(
  field: string,
  min: number,
  max: number,
  names?: string[],
): number[] | undefined {
  const values: number[] = [];
  for (const part of field.split(',')) {
    const [from, to, ...rest] = part.split('-');
    if (rest.length > 0) return undefined;
    const start = parseValue(from, min, max, names);
    const end = to == null ? start : parseValue(to, min, max, names);
    if (start == null || end == null || end < start) return undefined;
    for (let value = start; value <= end; value++) values.push(value);
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

// `*/n`, only when n divides the field's range: `*/45` fires at :00 and :45, which no
// "every 45 minutes" describes.
function step(field: string, range: number): number | undefined {
  const match = /^\*\/(\d+)$/.exec(field);
  const every = match == null ? 0 : Number(match[1]);
  return every > 0 && range % every === 0 ? every : undefined;
}

function time(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`;
}

function describeDays(days: number[]): string {
  const key = days.join(',');
  if (key === '1,2,3,4,5') return 'Weekdays';
  if (key === '0,6') return 'Weekends';
  if (days.length === 1) return `Every ${DAYS[days[0]]}`;
  return joinWords(days.map((day) => SHORT_DAYS[day]));
}

function describeTimes(minuteField: string, hourField: string): string | undefined {
  const minutes = parseList(minuteField, 0, 59);
  if (hourField === '*') {
    if (minuteField === '*') return 'every minute';
    const every = step(minuteField, 60);
    if (every != null) return every === 1 ? 'every minute' : `every ${every} minutes`;
    if (minutes?.length === 1) {
      return minutes[0] === 0 ? 'every hour' : `every hour at :${time(0, minutes[0]).slice(3)}`;
    }
    return undefined;
  }
  if (minutes?.length !== 1) return undefined;
  const everyHours = step(hourField, 24);
  if (everyHours != null) {
    const at = minutes[0] === 0 ? '' : ` at :${time(0, minutes[0]).slice(3)}`;
    return everyHours === 1 ? `every hour${at}` : `every ${everyHours} hours${at}`;
  }
  const hours = parseList(hourField, 0, 23);
  if (hours == null) return undefined;
  return `at ${joinWords(hours.map((hour) => time(hour, minutes[0])))}`;
}

export function describeCron(cron: string | null | undefined): string | undefined {
  if (cron == null) return undefined;
  let fields = cron.trim().split(/\s+/);
  // A six-field cron leads with seconds; only a whole minute reads naturally.
  if (fields.length === 6) {
    if (fields[0] !== '0') return undefined;
    fields = fields.slice(1);
  }
  if (fields.length !== 5) return undefined;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const times = describeTimes(minute, hour);
  if (times == null) return undefined;
  const repeating = hour === '*' || step(hour, 24) != null;

  if (dayOfMonth === '*' && month === '*') {
    if (dayOfWeek === '*') return repeating ? capitalize(times) : `Daily ${times}`;
    // 7 is Sunday too.
    const days = parseList(dayOfWeek, 0, 7, DAY_NAMES)?.map((day) => day % 7);
    if (days == null) return undefined;
    const unique = [...new Set(days)].sort((a, b) => a - b);
    return `${describeDays(unique)}${repeating ? ',' : ''} ${times}`;
  }

  if (dayOfWeek !== '*' || repeating) return undefined;
  const days = parseList(dayOfMonth, 1, 31);
  if (days == null) return undefined;
  const onDays = `on the ${joinWords(days.map(ordinal))}`;
  if (month === '*') return `Monthly ${onDays} ${times}`;
  const months = parseList(month, 1, 12, MONTH_NAMES);
  if (months == null) return undefined;
  return `Yearly ${onDays} of ${joinWords(months.map((value) => MONTHS[value - 1]))} ${times}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
