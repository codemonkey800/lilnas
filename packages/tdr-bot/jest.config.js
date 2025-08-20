module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts',
    '!**/__tests__/setup.ts',
    '!**/__tests__/test-utils.ts',
    '!**/__tests__/**/test-access-utils.ts',
    '!**/__tests__/**/test-mocks.types.ts',
  ],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    }],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@lilnas|nanoid|remark|unified|unist|vfile|bail|is-plain-obj|trough|mdast|unist-util-visit|unist-util-is|unist-util-visit-parents))',
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__tests__/**/*',
    '!src/**/__tests__/**/*',
    '!src/frontend/**/*', // Exclude Next.js frontend code
    '!src/main.ts', // Exclude main entry point
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@lilnas/utils/(.*)$': '<rootDir>/../utils/src/$1',
  },
  extensionsToTreatAsEsm: ['.ts'],
  resolver: undefined,
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 30000, // Longer timeout for LLM tests
}