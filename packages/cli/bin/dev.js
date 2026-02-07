#!/usr/bin/env node

// eslint-disable-next-line node:no-process-env
process.env.NODE_ENV = 'development'

import { execute } from '@oclif/core'

await execute({ development: true, dir: import.meta.url })
