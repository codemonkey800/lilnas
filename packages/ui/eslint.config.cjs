/* eslint-disable @typescript-eslint/no-require-imports */

const { base, react } = require('@lilnas/eslint')

module.exports = [
  ...base,
  ...react,
  {
    // The package compiles with plain `tsc`, which does not rewrite a `src/…`
    // specifier, so anything outside the barrel imports its siblings relatively.
    files: ['src/**/*.{ts,tsx}'],
    rules: { 'no-relative-import-paths/no-relative-import-paths': 'off' },
  },
  {
    // The barrel re-exports every module. While a module is still an empty
    // placeholder (`export {}`) `import-x/export` reports "no named exports";
    // TypeScript itself rejects a genuinely ambiguous `export *`.
    files: ['src/index.ts'],
    rules: { 'import-x/export': 'off' },
  },
]
