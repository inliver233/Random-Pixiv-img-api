import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const { parseRefreshTokensValue } = require('../src/config/env.js');
const pixivAuthService = require('../src/services/pixivAuthService.js');

describe('parseRefreshTokensValue', () => {
  it('parses JSON array string', () => {
    expect(parseRefreshTokensValue('["t1","t2"]')).toEqual(['t1', 't2']);
  });

  it('parses comma-separated string', () => {
    expect(parseRefreshTokensValue('t1,t2')).toEqual(['t1', 't2']);
  });
});

describe('pixivAuthService.selectTokenIndex', () => {
  it('round_robin increments index', () => {
    expect(pixivAuthService.selectTokenIndex('round_robin', 2, 0)).toBe(1);
    expect(pixivAuthService.selectTokenIndex('round_robin', 2, 1)).toBe(0);
  });

  it('random uses Math.random', () => {
    const originalRandom = Math.random;
    Math.random = () => 0.9;
    try {
      expect(pixivAuthService.selectTokenIndex('random', 2, 0)).toBe(1);
    } finally {
      Math.random = originalRandom;
    }
  });
});

