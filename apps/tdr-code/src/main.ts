import * as dotenv from 'dotenv'
import * as sourceMapSupport from 'source-map-support'

async function main() {
  dotenv.config()
  sourceMapSupport.install()

  const { bootstrapApp } = await import('./bootstrap')
  await bootstrapApp()
}

main()
