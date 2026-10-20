// Two Jest PROJECTS share this one config file/invocation (`pnpm test` runs
// both together): the pre-existing backend project (unchanged behavior,
// testEnvironment: 'node') and a new frontend project (U6) scoped to
// exactly ONE file this unit adds: src/app/__tests__/login.spec.tsx.
//
// middleware.spec.ts (the other new U6 test file) deliberately runs under
// the BACKEND (node) project, not the frontend (jsdom) one, even though it
// lives in the same src/app/__tests__/ directory as login.spec.tsx — despite
// testing a Next.js middleware file, it needs no DOM at all (no
// document/window rendering), only the Fetch API classes (Request/Response/
// Headers) that next/server's NextRequest/NextResponse extend. Node 22
// provides those natively as real globals; jest-environment-jsdom does NOT
// (jsdom scopes itself to the DOM, not networking — confirmed empirically:
// requiring next/server under the frontend project throws "ReferenceError:
// Request is not defined" at import time, because jsdom's environment swaps
// in its own global realm that doesn't inherit Node's outer-process fetch
// globals). Rather than hand-polyfill Request/Response/Headers into jsdom's
// realm (fragile, and solves a problem this file doesn't actually have),
// middleware.spec.ts simply runs where those globals already exist for
// free. See each project's testMatch below for the exact split.
//
// Why a SEPARATE project instead of just switching the global
// testEnvironment to 'jsdom': every existing backend test (NestJS
// controllers/services, the auth guard, the guild gate, the DB repos, …)
// runs under 'node' today and must keep doing so — jsdom is a strictly
// different global environment, and there is no other app in this monorepo
// with BOTH frontend and backend Jest suites to crib a split from
// (apps/portal and apps/dashcam were checked — neither has any frontend
// .spec/.test files at all, only backend-shaped jest.config.js entries
// identical in shape to this file's prior single-project form). Jest's own
// multi-project support (`projects: [...]`, confirmed against the installed
// jest@30.2.0's own docs) is the tool built for exactly this: two
// independently-configured environments in one `jest`/`pnpm test`
// invocation, rather than a second jest.config file + a second
// package.json script the CI/dev workflow would need to remember to run.
//
// Coverage settings (`collectCoverageFrom`/`coverageDirectory`/
// `coverageReporters`) stay at the TOP LEVEL, unchanged from before this
// split — Jest aggregates coverage across all projects sharing one
// invocation, and the existing `!src/app/**/*` exclusion already keeps
// every src/app/** file (frontend pages/components, including the two new
// login/middleware files) out of the coverage-collection scope, so nothing
// needed to change there for this unit.
const backendProject = {
  displayName: 'backend',
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts',
    '!**/__tests__/setup.ts',
    '!**/__tests__/test-utils.ts',
    '!**/__tests__/test-constants.ts',
    '!**/__tests__/config/*.ts',
    '!**/__tests__/factories/*.ts',
    '!**/__tests__/helpers/*.ts',
    '!**/__tests__/fixtures/*.ts',
    // U6: exclude the frontend project's OWN .tsx specs from this
    // .ts-pattern-based testMatch (moot in practice — a .tsx file never
    // matches a '*.ts' glob — but explicit rather than relying on that
    // alone) while still picking up middleware.spec.ts (a plain .ts file
    // under app/__tests__/) via the un-excluded '**/__tests__/**/*.ts'
    // pattern above. login.spec.tsx runs ONLY under frontendProject below.
    '!**/app/__tests__/**/*.tsx',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  transform: {
    // Unchanged from before Phase D (U2) — every existing .ts file (app code
    // and tests) keeps going through this exact pattern/options.
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
    // The Better Auth package family and msw resolve to pure-ESM builds. The
    // test scripts run Jest with NODE_OPTIONS=--experimental-vm-modules, so
    // it loads them untransformed through Node's require(esm); only
    // workspace packages still need transforming.
    //
    // The lookahead uses a leading `.*` because pnpm's virtual store nests
    // real packages under `.pnpm/<hash>/node_modules/<pkg>` — without it the
    // lookahead would only ever see `.pnpm/...` after the first
    // /node_modules/ segment.
    '/node_modules/(?!.*(@lilnas)/)',
  ],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@lilnas/utils/(.*)$': '<rootDir>/../../packages/utils/src/$1',
  },
}

// U6: frontend project — scoped to login.spec.tsx only (middleware.spec.ts
// runs under backendProject above; see that project's header comment for
// why). jsdom is required here because login.spec.tsx renders actual React
// components via @testing-library/react, which needs a real DOM to mount
// into. Everything NOT overridden here (transform, transformIgnorePatterns,
// moduleNameMapper) is duplicated from backendProject rather than shared by
// reference, because Jest's `projects` entries are independent, fully
// resolved configs — there is no config-inheritance/`extends` mechanism
// between them, so common settings must be repeated per project.
const frontendProject = {
  displayName: 'frontend',
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  rootDir: '.',
  roots: ['<rootDir>/src/app'],
  // Logs viewer (U6+): broadened from '**/app/__tests__/**/*.tsx' so specs
  // nested under a feature directory (e.g. app/logs/__tests__/) are
  // discovered too — the original glob only matched the single top-level
  // app/__tests__/ dir and would have silently skipped every spec this
  // feature adds (confirmed via `jest --listTests` before this fix).
  testMatch: ['**/app/**/__tests__/**/*.tsx'],
  setupFilesAfterEnv: ['<rootDir>/src/app/__tests__/setup.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
        },
      },
    ],
  },
  transformIgnorePatterns: [
    // Same rationale as backendProject's entry.
    '/node_modules/(?!.*(@lilnas)/)',
  ],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@lilnas/utils/(.*)$': '<rootDir>/../../packages/utils/src/$1',
  },
}

// scripts project — bash wrapper integration tests (scripts/git,
// scripts/git-ssh-wrapper.sh). These spawn real bash + fake git executables
// via execFile; the specs reference no app source modules (only
// node:child_process/fs/os/path), so they get their own minimal project
// rather than widening backendProject's `roots` to include `scripts/` (which
// would also pull in that project's setup file and moduleNameMapper
// entries for no reason). Neither
// existing project's `roots` (`src`, `src/app`) includes `scripts/`, so
// scripts/__tests__/*.spec.ts were previously never discovered by
// `pnpm test`/`turbo test` at all (confirmed via `npx jest --listTests`).
const scriptsProject = {
  displayName: 'scripts',
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/scripts'],
  testMatch: ['**/__tests__/**/*.spec.ts'],
}

module.exports = {
  projects: [backendProject, frontendProject, scriptsProject],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__tests__/**/*',
    '!src/**/__tests__/**/*',
    '!src/app/**/*',
    '!src/main.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 30000,
  forceExit: true,
}
