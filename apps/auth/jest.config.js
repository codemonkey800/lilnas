// Two Jest PROJECTS share this one invocation (`pnpm test` runs both
// together): the pre-existing backend project (unchanged behavior,
// testEnvironment: 'node') and a new frontend project (U6) for
// src/app/pending/__tests__/pending-page.spec.tsx, the first component test
// this app has. Mirrors apps/tdr-code/jest.config.js's identical split —
// see that file's own header comment for the full "why a separate project
// instead of switching testEnvironment globally" rationale (short version:
// every existing backend test must keep running under 'node', and jsdom is
// a strictly different global environment with no per-file override).
//
// Jest's `projects` entries are independent, fully resolved configs with no
// config-inheritance/`extends` mechanism between them, so anything the two
// projects need identically has to be assembled here and spread into both
// rather than declared once — `shared` below (M5) is that assembly, split
// from the two projects' own genuinely-different settings (testEnvironment,
// roots, testMatch, and each project's own ts-jest transform entry).
const shared = {
  transformIgnorePatterns: [
    // The Better Auth package family ships pure ESM only. The test scripts
    // run Jest with NODE_OPTIONS=--experimental-vm-modules, so it loads them
    // untransformed through Node's require(esm); only workspace packages
    // still need transforming.
    //
    // The lookahead uses a leading `.*` because pnpm's virtual store nests
    // real packages under `.pnpm/<hash>/node_modules/<pkg>` — without it the
    // lookahead would only ever see `.pnpm/...` after the first
    // /node_modules/ segment.
    '/node_modules/(?!.*(@lilnas)/)',
  ],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    // NOTE: apps/download/jest.config.js has a stale copy of this mapping
    // pointing at '<rootDir>/../utils/src/$1' (resolves to the nonexistent
    // apps/utils/src). The real package lives at packages/utils — verified
    // against apps/swole/jest.config.js and apps/tdr-code/jest.config.js,
    // and confirmed working here by actually running a test that imports
    // from '@lilnas/utils/health' (see db/__tests__/schema.spec.ts).
    '^@lilnas/utils/(.*)$': '<rootDir>/../../packages/utils/src/$1',
  },
}

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
    '!**/__tests__/fixtures/**/*',
    '!**/__tests__/helpers/**/*',
    // U6: the frontend project's own .tsx specs never match this .ts-only
    // testMatch (a .tsx file never matches a '*.ts' glob), but excluded
    // explicitly rather than relying on that alone — mirrors
    // apps/tdr-code/jest.config.js's identical belt-and-suspenders entry.
    '!**/app/**/__tests__/**/*.tsx',
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

// U6: frontend project — scoped to pending-page.spec.tsx only. jsdom is
// required because that spec renders PendingClient via
// @testing-library/react, which needs a real DOM to mount into.
const frontendProject = {
  displayName: 'frontend',
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  rootDir: '.',
  roots: ['<rootDir>/src/app'],
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
  ...shared,
}

module.exports = {
  projects: [backendProject, frontendProject],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__tests__/**/*',
    '!src/**/__tests__/**/*',
    '!src/app/**/*',
  ],
  coverageDirectory: 'coverage',
  // M4: 'text' writes straight to stdout, which forceExit's process.exit()
  // below can race and truncate when stdout is piped/redirected rather than
  // a TTY (`pnpm test:cov > file` reliably loses it; an interactive
  // terminal usually doesn't) — Node's piped-stdout writes aren't
  // guaranteed synchronous, so a forced exit can fire before they land.
  // 'json-summary' has no such race: istanbul writes it with a plain
  // synchronous fs call before Jest's own "done" point, so
  // scripts/print-coverage-summary.js (chained after `jest --coverage` in
  // the test:cov script) always has real data to read regardless of how
  // forceExit's timing lands. Kept 'text' anyway for interactive/TTY runs
  // and IDE integrations that invoke `jest --coverage` directly — it's
  // harmless when it races (test:cov's own reliable table still prints
  // right after), and correct the rest of the time.
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 10000,
  // M4: without this, a worker warns "failed to exit gracefully" (every
  // test still passes) and gets force-exited anyway once its own timeout
  // hits — the only effect of removing this line would be a slower, noisier
  // exit, not a real fix. This was originally attributed to
  // sse.controller.spec.ts's RxJS timer()-based keepalive not always
  // tearing down its setInterval the instant a test's take(N) completes,
  // matching apps/tdr-code/jest.config.js's identical forceExit for its own
  // sse-hub.service.ts/sse.controller.ts tests. That's now confirmed stale:
  // running with that spec file excluded (or any other single spec file
  // excluded) still needs forceExit, while `jest --runInBand` (no worker
  // pool at all) never does — the lingering handle is in jest-worker's own
  // child-process pool teardown, not a leak in this app's code. See
  // coverageReporters above and scripts/print-coverage-summary.js for why
  // this matters beyond the warning noise: the interaction between this
  // forced exit and non-TTY stdout is what made `pnpm test:cov`'s own
  // coverage table unreliable.
  forceExit: true,
}
