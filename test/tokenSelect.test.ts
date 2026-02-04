import { describe, expect, it } from 'vitest';

import { selectTokenIndex } from '../src/services/pixivAuthService.ts';

describe('selectTokenIndex', () => {
  it('round_robin selects next index', () => {
    expect(selectTokenIndex('round_robin', 3, 0)).toBe(1);
    expect(selectTokenIndex('round_robin', 3, 1)).toBe(2);
    expect(selectTokenIndex('round_robin', 3, 2)).toBe(0);
  });

  it('random uses injected random()', () => {
    expect(selectTokenIndex('random', 3, 0, { random: () => 0 })).toBe(0);
    expect(selectTokenIndex('random', 3, 0, { random: () => 0.999 })).toBe(2);
  });

  it('least_error picks the lowest error and ties break with RR', () => {
    const errors = [0, 2, 0];
    expect(selectTokenIndex('least_error', 3, 0, { errors })).toBe(2);
    expect(selectTokenIndex('least_error', 3, 2, { errors })).toBe(0);
  });

  it('least_error falls back to round_robin when errors length mismatches', () => {
    expect(selectTokenIndex('least_error', 2, 0, { errors: [0] })).toBe(1);
  });

  it('weighted picks index by weight using injected random()', () => {
    const weights = [2, 1, 1]; // total=4
    expect(selectTokenIndex('weighted', 3, 0, { weights, random: () => 0 })).toBe(0); // r=0
    expect(selectTokenIndex('weighted', 3, 0, { weights, random: () => 0.49 })).toBe(0); // r=1.96
    expect(selectTokenIndex('weighted', 3, 0, { weights, random: () => 0.51 })).toBe(1); // r=2.04
    expect(selectTokenIndex('weighted', 3, 0, { weights, random: () => 0.99 })).toBe(2); // r=3.96
  });

  it('weighted falls back to round_robin when weights invalid', () => {
    expect(selectTokenIndex('weighted', 2, 0, { weights: [0, 0] })).toBe(1);
    expect(selectTokenIndex('weighted', 2, 0, { weights: [1] })).toBe(1);
  });
});

