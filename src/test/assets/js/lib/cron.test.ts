import { describe, expect, it } from 'vitest';

import { describeCron } from '../../../../main/resources/assets/js/lib/cron';

describe('describeCron', () => {
  it.each([
    ['* * * * *', 'Every minute'],
    ['*/15 * * * *', 'Every 15 minutes'],
    ['0 * * * *', 'Every hour'],
    ['30 * * * *', 'Every hour at :30'],
    ['5 */6 * * *', 'Every 6 hours at :05'],
    ['0 2 * * *', 'Daily at 02:00'],
    ['0 9,17 * * *', 'Daily at 09:00 and 17:00'],
    ['0 6 * * 1', 'Every Monday at 06:00'],
    ['0 6 * * 7', 'Every Sunday at 06:00'],
    ['0 6 * * MON', 'Every Monday at 06:00'],
    ['30 8 * * 1-5', 'Weekdays at 08:30'],
    ['0 10 * * 0,6', 'Weekends at 10:00'],
    ['0 9 * * 1,3,5', 'Mon, Wed and Fri at 09:00'],
    ['*/30 * * * 1-5', 'Weekdays, every 30 minutes'],
    ['0 3 1 * *', 'Monthly on the 1st at 03:00'],
    ['0 3 2,22 * *', 'Monthly on the 2nd and 22nd at 03:00'],
    ['0 0 1 1 *', 'Yearly on the 1st of January at 00:00'],
    ['0 0 13 JUN *', 'Yearly on the 13th of June at 00:00'],
    ['0 0 6 * * *', 'Daily at 06:00'],
    ['  0   2 * * *  ', 'Daily at 02:00'],
  ])('should say %s as "%s"', (cron, words) => {
    expect(describeCron(cron)).toBe(words);
  });

  it.each([
    ['a seconds field other than 0', '30 0 6 * * *'],
    ['too few fields', '0 6 * *'],
    ['a step in the day of month', '0 6 */2 * *'],
    ['a day of month and a day of week', '0 6 1 * 1'],
    ['an out-of-range hour', '0 24 * * *'],
    ['a reversed range', '0 6 * * 5-1'],
    ['a list of minutes with a fixed hour', '0,30 6 * * *'],
    ['a Quartz-style question mark', '0 6 ? * MON'],
    ['a minute step that does not divide the hour', '*/45 * * * *'],
    ['an hour step that does not divide the day', '0 */7 * * *'],
    ['nothing', undefined],
  ])('should leave a cron with %s to the raw expression', (_label, cron) => {
    expect(describeCron(cron)).toBeUndefined();
  });
});
