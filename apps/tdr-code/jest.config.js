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
    // New, separate entry (Phase D — U2): the Better Auth package family
    // below ships pure ESM only (`"type": "module"`, no CJS build), so
    // Jest's CJS-based require() can't load their .mjs files directly.
    // ts-jest/tsc CANNOT be used for this despite `allowJs` + forcing
    // `module: "commonjs"` — TypeScript treats a `.mjs` file's EXTENSION as
    // authoritative for module kind and preserves import/export syntax
    // regardless of the module compiler option (verified directly against
    // `ts.transpileModule`: even with module: CommonJS forced, the output
    // still contained raw `import` statements). babel-jest doesn't have
    // this extension-based restriction — its CommonJS transform plugin
    // rewrites import/export based on the SOURCE SYNTAX, not the file
    // extension, so it can genuinely downcompile these to require() calls.
    // Scoped to its own pattern (not merged into the .ts entry above) so
    // this can never affect how this app's own .ts files compile.
    '^.+\\.m?js$': [
      'babel-jest',
      {
        presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
        // Referenced by path (a string), not as an inline function value —
        // see that file's own header comment for why this is required, not
        // just tidier (babel-jest's cache-key computation needs the
        // transform config to be serializable; a live function reference
        // here works on a fresh cache but throws `.plugins[0] must be a
        // string, object, function` intermittently once Jest needs to
        // validate a cache key against an already-cached transform result
        // — confirmed reproducible across a full suite run).
        plugins: [require.resolve('./babel-plugin-import-meta-to-commonjs')],
        babelrc: false,
        configFile: false,
      },
    ],
  },
  transformIgnorePatterns: [
    // Phase D (U2): better-auth, its scoped @better-auth/* packages (core,
    // utils, drizzle-adapter, etc.), @thallesp/nestjs-better-auth, and their
    // own pure-ESM-only dependencies are un-ignored (transformed) here —
    // Jest's default is to skip transforming anything under node_modules,
    // but these packages have no CJS build for Jest's CJS-based module
    // loader to require() directly.
    //
    // Phase D (U3): msw joins the same allowlist for the same underlying
    // reason, even though `msw` DOES ship a real CJS build (`lib/*/index.js`,
    // confirmed by requiring it directly by absolute path) — the problem is
    // that neither Node's nor Jest's default `exports`-map resolution for
    // the bare specifiers `msw`/`msw/node` picks that CJS entry; both land on
    // the `.mjs` build instead (confirmed empirically: `require.resolve('msw')`
    // in plain Node, outside Jest entirely, already resolves to
    // `lib/core/index.mjs`). A `moduleNameMapper` override to msw's CJS path
    // was tried and rejected: msw's OWN dependencies (`@mswjs/interceptors`
    // and its many deep subpath exports, `rettime`, etc.) are only resolvable
    // from *inside* msw's own node_modules tree, not this app's directly
    // declared deps, so pinning around them would mean mapping an
    // open-ended, version/hash-fragile set of absolute pnpm-store paths.
    // Un-ignoring by package name (this list) is what survives a lockfile
    // hash change; @mswjs/interceptors, rettime, and other msw runtime deps
    // that hit this codepath are added alongside it for the same reason.
    //
    // The lookahead uses a leading `.*` (not just an immediately-following
    // name) because pnpm's virtual store nests real packages under
    // `.pnpm/<hash>/node_modules/<pkg>` — a plain `/node_modules/(?!(name))`
    // check (the pre-existing @lilnas|nanoid form below) only inspects the
    // characters immediately after the FIRST /node_modules/ segment, which
    // under pnpm is always `.pnpm/...`, never the real package name — so it
    // would silently keep ignoring (never transforming) any scoped/hashed
    // pnpm-nested package regardless of what's in the allowlist. `.*` lets
    // the lookahead scan past that intermediate .pnpm/<hash>/node_modules/
    // segment to find the real package name deeper in the path.
    '/node_modules/(?!.*(@lilnas|nanoid|better-auth|@better-auth|@thallesp|better-call|@better-fetch|@noble|nanostores|defu|jose|kysely|rou3|msw|@mswjs|rettime|@open-draft|is-node-process|outvariant|strict-event-emitter|until-async|headers-polyfill)/)',
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
  testMatch: ['**/app/__tests__/**/*.tsx'],
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
    // Same rationale as backendProject's entry: better-auth's `/react`
    // subpath (src/app/lib/auth-client.ts) pulls in the same pure-ESM
    // package family, plus `nanostores` for the reactive useSession() store
    // underneath better-auth/react.
    '/node_modules/(?!.*(@lilnas|nanoid|better-auth|@better-auth|@thallesp|better-call|@better-fetch|@noble|nanostores|defu|jose|kysely|rou3)/)',
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
    '!src/main.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 30000,
  forceExit: true,
}
