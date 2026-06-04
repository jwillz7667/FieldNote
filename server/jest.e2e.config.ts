import type { Config } from 'jest';

/**
 * End-to-end HTTP suite: boots the real NestJS app against local Docker infra and
 * drives it over HTTP with supertest. Covers auth, per-user scoping, idempotency,
 * and the jobs lifecycle. Run with `npm run test:e2e` (serial).
 */
const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.e2e-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 60_000,
};

export default config;
