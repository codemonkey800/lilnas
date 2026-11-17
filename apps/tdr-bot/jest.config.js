// Two Jest PROJECTS share this invocation: the pre-existing backend suite
// (`node`, unchanged) and a `jsdom` project for component tests under
// src/app and src/components. `testEnvironment` is a whole-project setting,
// so the split is the only way to run both. Projects do not inherit from the
// top level, so everything they share is assembled in `shared`.
const shared = {
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@lilnas/utils/(.*)$': '<rootDir>/../../packages/utils/src/$1',
    '^@lilnas/ui$': '<rootDir>/../../packages/ui/src/index.ts',
  },
  clearMocks: true,
  restoreMocks: true,
}

const nodeProject = {
  displayName: 'node',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts',
    '!**/*.live.test.ts', // run by `pnpm test:live`
    '!**/__tests__/setup.ts',
    '!**/__tests__/setup-dom.ts', // jsdom project's setup module
    '!**/__tests__/test-utils.ts',
    '!**/__tests__/test-constants.ts',
    '!**/__tests__/config/*.ts',
    '!**/__tests__/factories/*.ts',
    '!**/__tests__/helpers/*.ts',
    '!**/__tests__/matchers/*.ts',
    '!**/__tests__/fixtures/*.ts',
  ],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
      },
    ],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@lilnas|nanoid|remark|unified|unist|vfile|bail|is-plain-obj|trough|mdast|unist-util-visit|unist-util-is|unist-util-visit-parents))',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  resolver: undefined,
  testTimeout: 30000, // Longer timeout for LLM tests
  ...shared,
}

const jsdomProject = {
  displayName: 'jsdom',
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src/app', '<rootDir>/src/components'],
  testMatch: ['**/__tests__/**/*.tsx'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup-dom.ts'],
  transform: {
    // The app tsconfig sets `jsx: "preserve"` (Next does the transform in the
    // real build); ts-jest has no such step, so it emits runnable JS itself.
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }],
  },
  transformIgnorePatterns: ['/node_modules/(?!(@lilnas)/)'],
  testTimeout: 10000,
  ...shared,
}

module.exports = {
  projects: [nodeProject, jsdomProject],
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
}
