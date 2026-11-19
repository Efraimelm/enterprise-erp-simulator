import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test' },
    globalSetup: ['./tests/global-setup.js'],
    include: ['tests/**/*.test.js'],
    // Os testes usam o mesmo banco erp_test: rodam um arquivo por vez.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
