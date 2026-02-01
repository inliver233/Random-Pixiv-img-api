import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,js}'],
    setupFiles: ['test/setup.ts'],
    clearMocks: true,
    testTimeout: 15_000,
  },
});
