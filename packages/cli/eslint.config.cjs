/* eslint-disable @typescript-eslint/no-require-imports */

const { base } = require('@lilnas/eslint')

module.exports = [
  ...base,
  {
    rules: {
      // Internal imports within the CLI package use relative paths, which is
      // necessary for correct module resolution in the compiled CommonJS output.
      'no-relative-import-paths/no-relative-import-paths': 'off',
    },
  },
]
