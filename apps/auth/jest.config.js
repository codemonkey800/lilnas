// Two Jest PROJECTS share this one invocation (`pnpm test` runs both
// together): the pre-existing backend project (unchanged behavior,
// testEnvironment: 'node') and a new frontend project (U6) for
// src/app/pending/__tests__/pending-page.spec.tsx, the first component test
// this app has. Mirrors apps/tdr-code/jest.config.js's identical split —
// see that file's own header comment for the full "why a separate project
// instead of switching testEnvironment globally" rationale (short version:
// every existing backend test must keep running under 'node', and jsdom is
// a strictly different global environment with no per-file override).
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
    // U3: the Better Auth package family ships pure ESM only
    // (`"type": "module"`, no CJS build) — Jest's CJS-based require() can't
    // load their .mjs files directly. ts-jest/tsc CANNOT be used for this
    // despite `allowJs` + forcing `module: "commonjs"` — TypeScript treats a
    // `.mjs` file's EXTENSION as authoritative for module kind and preserves
    // import/export syntax regardless of the module compiler option.
    // babel-jest doesn't have this extension-based restriction — its
    // CommonJS transform plugin rewrites import/export based on the SOURCE
    // SYNTAX, not the file extension. Ported verbatim from
    // apps/tdr-code/jest.config.js, which hit and solved this exact problem
    // first for the exact same package family (see that file's own header
    // comment for the full "why", including the cache-key rationale for
    // referencing the plugin by path below rather than inline).
    '^.+\\.m?js$': [
      'babel-jest',
      {
        presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
        plugins: [require.resolve('./babel-plugin-import-meta-to-commonjs')],
        babelrc: false,
        configFile: false,
      },
    ],
  },
  transformIgnorePatterns: [
    // better-auth, its scoped @better-auth/* packages, @thallesp/nestjs-
    // better-auth, and their own pure-ESM-only dependencies are un-ignored
    // (transformed) here — Jest's default is to skip transforming anything
    // under node_modules, but these packages have no CJS build for Jest's
    // CJS-based module loader to require() directly. lru-cache/nanoid were
    // already un-ignored by U2 for an unrelated reason and are kept as-is.
    //
    // The lookahead uses a leading `.*` (not just an immediately-following
    // name) because pnpm's virtual store nests real packages under
    // `.pnpm/<hash>/node_modules/<pkg>` — a plain `/node_modules/(?!(name))`
    // check only inspects the characters immediately after the FIRST
    // /node_modules/ segment, which under pnpm is always `.pnpm/...`, never
    // the real package name — so it would silently keep ignoring (never
    // transforming) any scoped/hashed pnpm-nested package regardless of
    // what's in the allowlist. `.*` lets the lookahead scan past that
    // intermediate .pnpm/<hash>/node_modules/ segment to find the real
    // package name deeper in the path. Ported from
    // apps/tdr-code/jest.config.js's identical, already-proven-correct
    // pattern.
    '/node_modules/(?!.*(@lilnas|nanoid|lru-cache|better-auth|@better-auth|@thallesp|better-call|@better-fetch|@noble|nanostores|defu|jose|kysely|rou3)/)',
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

// U6: frontend project — scoped to pending-page.spec.tsx only. jsdom is
// required because that spec renders PendingClient via
// @testing-library/react, which needs a real DOM to mount into.
// Everything NOT overridden here is duplicated from backendProject rather
// than shared by reference, because Jest's `projects` entries are
// independent, fully resolved configs with no config-inheritance/`extends`
// mechanism between them — same as apps/tdr-code/jest.config.js's identical
// split.
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
    '^.+\\.m?js$': [
      'babel-jest',
      {
        presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
        plugins: [require.resolve('./babel-plugin-import-meta-to-commonjs')],
        babelrc: false,
        configFile: false,
      },
    ],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!.*(@lilnas|nanoid|lru-cache|better-auth|@better-auth|@thallesp|better-call|@better-fetch|@noble|nanostores|defu|jose|kysely|rou3)/)',
  ],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@lilnas/utils/(.*)$': '<rootDir>/../../packages/utils/src/$1',
  },
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
  coverageReporters: ['text', 'lcov', 'html'],
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 10000,
  // U6: sse.controller.spec.ts's keepalive tests use RxJS's timer() (the
  // same apps/tdr-code/src/sse/sse.controller.ts pattern), whose
  // underlying setInterval isn't always torn down the instant a test's
  // take(N) completes, even though every test itself passes — a Jest
  // worker process warns "failed to exit gracefully" without this.
  // apps/tdr-code/jest.config.js carries the identical forceExit: true for
  // the identical reason (its own sse-hub.service.ts and sse.controller.ts
  // tests hit the same RxJS-timer-lifecycle class of issue).
  forceExit: true,
}
