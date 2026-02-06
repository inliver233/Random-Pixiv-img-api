import { describe, expect, it } from 'vitest';

import { hasEffectiveFilterValue } from '../src/admin/utils/filterValue';

describe('hasEffectiveFilterValue', () => {
  it('returns false for empty values used by AdminJS filter forms', () => {
    expect(hasEffectiveFilterValue(undefined)).toBe(false);
    expect(hasEffectiveFilterValue(null)).toBe(false);
    expect(hasEffectiveFilterValue('')).toBe(false);
    expect(hasEffectiveFilterValue('   ')).toBe(false);
    expect(hasEffectiveFilterValue([])).toBe(false);
  });

  it('returns true for valid scalar and list filter inputs', () => {
    expect(hasEffectiveFilterValue('1')).toBe(true);
    expect(hasEffectiveFilterValue(1)).toBe(true);
    expect(hasEffectiveFilterValue(0)).toBe(true);
    expect(hasEffectiveFilterValue(false)).toBe(true);
    expect(hasEffectiveFilterValue(['token-1'])).toBe(true);
  });
});

