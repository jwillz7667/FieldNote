import type { Config } from 'jest';

/**
 * Unit tests: fast, no I/O. Cover pure domain logic (severity mapping, report
 * normalization, config validation, prompt building). Integration/e2e suites live
 * in jest.integration.config.ts / jest.e2e.config.ts and run against real infra.
 */
const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.module.ts',
    '!src/main.ts',
    '!src/worker.ts',
    '!src/openapi.ts',
    '!src/**/*.dto.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  clearMocks: true,
};

export default config;
