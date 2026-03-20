import * as dotenv from 'dotenv'
import * as sourceMapSupport from 'source-map-support'

async function main() {
  dotenv.config()
  sourceMapSupport.install()

  // Dynamically import bootstrap so that top level `env()` calls use the values
  // from `.env`
  const { bootstrapApp } = await import('./bootstrap')
  await bootstrapApp()
}

main()
