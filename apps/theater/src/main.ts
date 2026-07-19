import * as dotenv from 'dotenv'
import * as sourceMapSupport from 'source-map-support'

async function main() {
  dotenv.config()
  sourceMapSupport.install()

  // dynamically import bootstrap so that top level `env()` calls use the values
  // from `.env`
  const { bootstrap } = await import('./bootstrap')
  await bootstrap()
}

main()
