// A single jsdom project: every spec in this package renders components.
// The transform emits its own JSX (`react-jsx`) because ts-jest has no
// downstream compiler step, and `@lilnas/utils/*` is mapped to source so the
// tests never depend on a prior `@lilnas/utils` build.
module.exports = {
  displayName: 'jsdom',
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.{ts,tsx}', '**/?(*.)+(spec|test).{ts,tsx}'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/__tests__/setup-dom\\.ts$',
    '/__tests__/(fixtures|helpers)/',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup-dom.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          module: 'commonjs',
          moduleResolution: 'bundler',
          baseUrl: '.',
          paths: { 'src/*': ['./src/*'] },
          types: ['jest', 'node', '@testing-library/jest-dom'],
        },
      },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!(@lilnas)/)'],
  moduleNameMapper: {
    // The repo's lint rule rewrites relative imports to `src/...`.
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@lilnas/utils/(.*)$': '<rootDir>/../utils/src/$1',
  },
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 10000,
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**/*',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
}
