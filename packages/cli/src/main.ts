import { match } from 'ts-pattern'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { down } from './commands/down'
import { list } from './commands/list'
import { redeploy } from './commands/redeploy'
import { syncPhotos } from './commands/sync-photos'
import { up } from './commands/up'
import { getServices } from './utils'

async function main() {
  const services = await getServices()

  const argParser = yargs(hideBin(process.argv))
    .command('list', 'Lists all services')
    .command('up [services...]', 'Deploys a service', args =>
      args.positional('services', { type: 'string', choices: services }),
    )
    .command('down [services...]', 'Brings down a service', args =>
      args.positional('services', { type: 'string', choices: services }),
    )
    .command('redeploy [services...]', 'Redeploys a service', args =>
      args.positional('services', { type: 'string', choices: services }),
    )
    .command('sync-photos', 'Syncs iCloud photos to a local directory', args =>
      args
        .option('email', {
          type: 'string',
          description: 'iCloud email address',
          requiresArg: true,
        })
        .option('dest', {
          type: 'string',
          description: 'Destination directory',
          requiresArg: true,
        }),
    )
    .help()
    .alias('h', 'help')
    .scriptName('lilnas')
    .showHelpOnFail(true)

  const args = await argParser.parse()

  const [command] = args._

  return match(command)
    .with('list', () => list())
    .with('up', () => up(args.services))
    .with('down', () => down(args.services))
    .with('redeploy', () => redeploy(args.services))
    .with('sync-photos', () =>
      syncPhotos({ dest: args.dest, email: args.email }),
    )
    .otherwise(() => argParser.showHelp())
}

main()
