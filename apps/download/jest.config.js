// Two Jest PROJECTS share this one invocation (`pnpm test` runs both): the
// pre-existing backend project (unchanged behavior, testEnvironment: 'node')
// and a jsdom project for the frontend rewrite's component tests. Mirrors
// apps/auth/jest.config.js and apps/tdr-code/jest.config.js, which made the
// identical split for the same reason: `testEnvironment` is a whole-project
// setting with no per-file override, and every existing backend test must
// keep running under 'node'.
//
// Jest's `projects` entries are independent, fully resolved configs — there
// is no inheritance from the top-level object and no `extends` between
// them. Anything both projects need identically has to be assembled here
// and spread into both; `shared` below is that assembly, kept separate from
// each project's genuinely-different settings (testEnvironment, testMatch,
// setupFilesAfterEnv, and each project's own ts-jest transform).
//
// NOTE: clearMocks/restoreMocks/testTimeout live in `shared`, NOT at the top
// level. They are per-project options, so leaving them only at the root
// (where they sat before this file grew projects) would silently stop
// applying to the backend suite that has always relied on them.
const shared = {
  transformIgnorePatterns: ['/node_modules/(?!(@lilnas|nanoid|lru-cache)/)'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@lilnas/media/(.*)$': '<rootDir>/../../packages/media/src/$1',
    '^@lilnas/utils/(.*)$': '<rootDir>/../../packages/utils/src/$1',
  },
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 10000,
}

const nodeProject = {
  displayName: 'node',
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts',
    '!**/__tests__/setup.ts',
    '!**/__tests__/test-utils.ts',
    // The jsdom project's setup module lives at src/__tests__/setup-dom.ts.
    // It is a .ts file directly inside a __tests__ directory, so it WOULD
    // otherwise match this project's first pattern and be collected as a
    // (zero-test, therefore failing) suite.
    '!**/__tests__/setup-dom.ts',
    '!**/__tests__/fixtures/**/*',
    '!**/__tests__/helpers/**/*',
    // The jsdom project's .tsx specs already can't match the '*.ts' globs
    // above — a '*.ts' glob does not match a '.tsx' filename — but they are
    // excluded explicitly so that the "component tests never run twice, and
    // never in the wrong environment" guarantee is stated in the config
    // rather than resting on a subtlety of glob semantics.
    '!**/__tests__/**/*.tsx',
    '!**/?(*.)+(spec|test).tsx',
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
  ...shared,
}

const jsdomProject = {
  displayName: 'jsdom',
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.tsx', '**/?(*.)+(spec|test).tsx'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup-dom.ts'],
  transform: {
    // The app's own tsconfig sets `jsx: "preserve"` because Next.js does the
    // JSX transform in the real build. ts-jest has no such downstream step,
    // so it has to emit runnable JS itself — hence `react-jsx` here.
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
        },
      },
    ],
  },
  ...shared,
}

module.exports = {
  projects: [nodeProject, jsdomProject],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__tests__/**/*',
    '!src/**/__tests__/**/*',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
}
