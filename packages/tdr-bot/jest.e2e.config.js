/**
 * Jest configuration for E2E tests
 * 
 * This configuration is specifically tailored for end-to-end testing
 * of media API clients with extended timeouts and E2E-specific settings.
 */

module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  displayName: 'E2E Tests',
  roots: ['<rootDir>/src'],
  
  // Only run E2E tests
  testMatch: [
    '**/src/media/__tests__/e2e/**/*.e2e.test.ts',
  ],
  
  // Exclude non-E2E test files
  testPathIgnorePatterns: [
    '/node_modules/',
    '.*\\.(?!e2e\\.test).*\\.test\\.ts$',
  ],
  
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        module: 'esnext',
      },
    }],
  },
  
  transformIgnorePatterns: [
    '/node_modules/(?!(nanoid|@lilnas)/)',
  ],
  
  // Module name mapping for internal imports
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@lilnas/utils/(.*)$': '<rootDir>/../utils/src/$1',
  },
  
  // Setup files for E2E tests
  setupFilesAfterEnv: [
    '<rootDir>/src/media/__tests__/e2e/setup.e2e.ts',
  ],
  
  // Increased timeouts for external service reliability
  testTimeout: 120000, // 2 minutes per test for external services
  
  // Coverage settings for E2E tests
  collectCoverage: false, // E2E tests don't need coverage
  
  // Verbose output for E2E tests
  verbose: true,
  
  // Fail fast on first error in CI
  bail: process.env.CI ? 1 : 0,
  
  // Maximum number of concurrent workers
  maxWorkers: process.env.CI ? 1 : 1, // Single worker to avoid API conflicts
  
  // Retry configuration disabled due to Jest compatibility
  // Note: testRetries is not supported in this Jest version
  // testRetries: process.env.CI ? 2 : 1, // More retries in CI environment
  
  // Test environment configuration
  // Note: globals config is deprecated, moved to transform config above
  
  // Reporters for E2E tests
  reporters: [
    'default',
    ...(process.env.CI ? [
      ['jest-junit', {
        outputDirectory: './coverage',
        outputName: 'e2e-test-results.xml',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathForSuiteName: true,
      }]
    ] : []),
  ],
  
  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
  
  // Force exit after tests complete (useful for E2E tests)
  forceExit: true,
  
  // Detect open handles (useful for debugging connection leaks)
  detectOpenHandles: true,
  
  // Extensions to treat as ESM
  extensionsToTreatAsEsm: ['.ts'],
}