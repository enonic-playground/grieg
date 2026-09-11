import { describe, expect, it } from 'vitest';

import { joinValues, toTag } from '../../main/resources/lib/text';

describe('joinValues', () => {
  it('should drop empty values and trim the rest', () => {
    expect(joinValues(['a ', '', ' b'])).toBe('a, b');
  });
});

describe('toTag', () => {
  it('should format a name/value pair', () => {
    expect(toTag('name', 'grieg')).toBe('name: grieg');
  });
});
