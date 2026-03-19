#!/usr/bin/env node
'use strict'

require('tsx/cjs/api').register()

const { execute } = require('@oclif/core')

const args = process.argv.slice(2)

if (args[0] === 'help' || args[0] === '-h') {
  // `lilnas help` → `lilnas --help`
  // `lilnas help redeploy` → `lilnas redeploy --help`
  // `lilnas -h` → `lilnas --help`
  process.argv.splice(2, 1)
  process.argv.push('--help')
}

execute({ dir: __dirname })
