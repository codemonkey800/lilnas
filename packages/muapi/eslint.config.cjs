/* eslint-disable @typescript-eslint/no-require-imports */

const { base } = require('@lilnas/eslint')

module.exports = [
  {
    ignores: ['src/generated/**'],
  },
  ...base,
]
