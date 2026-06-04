import type { Config } from 'jest';

/**
 * Integration suite: exercises the worker AI pipeline (transcribe → compile →
 * render → upload) against a real Postgres, real LocalStack R2, and real headless
 * Chromium, with mock STT/LLM providers. Run with `npm run test:integration`.
 */
const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.integration.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 120_000,
};

export default config;
