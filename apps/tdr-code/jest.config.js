module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
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
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@lilnas/utils/(.*)$': '<rootDir>/../../packages/utils/src/$1',
  },
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 30000,
  forceExit: true,
}
