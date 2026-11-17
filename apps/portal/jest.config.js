// Portal is Next-only (no Nest backend), so a single jsdom project covers
// every test. Mirrors the `jsdom` project in apps/dev/jest.config.js.
module.exports = {
  displayName: 'jsdom',
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.tsx', '**/?(*.)+(spec|test).tsx'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup-dom.ts'],
  transform: {
    // The app's tsconfig sets `jsx: "preserve"` because Next.js does the JSX
    // transform in the real build; ts-jest has to emit runnable JS itself.
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }],
  },
  transformIgnorePatterns: ['/node_modules/(?!(@lilnas)/)'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@lilnas/utils/(.*)$': '<rootDir>/../../packages/utils/src/$1',
    '^@lilnas/ui$': '<rootDir>/../../packages/ui/src/index.ts',
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
