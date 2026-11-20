/* eslint-disable @typescript-eslint/no-require-imports */

const { base, designSystem, react } = require('@lilnas/eslint')

module.exports = [...base, ...react, ...designSystem]
