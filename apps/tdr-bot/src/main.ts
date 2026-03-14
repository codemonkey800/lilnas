import { env } from '@lilnas/utils/env'
import * as dotenv from 'dotenv'
import { unlink } from 'fs/promises'
import * as sourceMapSupport from 'source-map-support'

import { EnvKeys } from './env'

async function cleanupLogFile() {
  const logFilePath = env(EnvKeys.LOG_FILE_PATH, '')

  if (logFilePath) {
    try {
      await unlink(logFilePath)
      console.log(`Cleaned up log file: ${logFilePath}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(
          `Warning: Could not delete log file ${logFilePath}:`,
          error,
        )
      }
    }
  }
}

async function runApp() {
  dotenv.config()
  sourceMapSupport.install()

  await cleanupLogFile()

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

  if (env(EnvKeys.GRAPH_TEST, 'false') === 'true') {
    await runGraphTest()
  } else {
    await runApp()
  }
}

main()
