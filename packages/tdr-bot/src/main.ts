import { env } from '@lilnas/utils/env'
import * as dotenv from 'dotenv'
import * as sourceMapSupport from 'source-map-support'

import { EnvKey } from './utils/env'

async function runApp() {
  dotenv.config()
  sourceMapSupport.install()

  // dynamically import bootstrap so that top level `env()` calls use the values
  // from `.env`
  const { bootstrapApp } = await import('./bootstrap')
  await bootstrapApp()
}

async function runGraphTest() {
  dotenv.config()
  sourceMapSupport.install()

  // dynamically import bootstrap so that top level `env()` calls use the values
  // from `.env`
  const { bootstrapGraphTest } = await import('./bootstrap')
  await bootstrapGraphTest()
}

async function main() {
  dotenv.config()
  sourceMapSupport.install()

  // Test application-only change for Docker build workflow
  if (env<EnvKey>('GRAPH_TEST', 'false') === 'true') {
    await runGraphTest()
  } else {
    await runApp()
  }
}

main()
