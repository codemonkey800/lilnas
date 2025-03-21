import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { deploy } from './commands/deploy'
import { list } from './commands/list'
import { syncPhotos } from './commands/sync-photos'
import { getServices } from './utils'

async function main() {
  const services = await getServices()

  const argParser = yargs(hideBin(process.argv))
    .command('list', 'Lists all services')
    .command('deploy [command]', 'Manage deployments', args =>
      args
        .command('up [services...]', 'Deploys a service', args =>
          args.positional('services', { type: 'string', choices: services }),
        )
        .command('down [services...]', 'Brings down a service', args =>
          args.positional('services', { type: 'string', choices: services }),
        )
        .command('redeploy [services...]', 'Redeploys a service', args =>
          args.positional('services', { type: 'string', choices: services }),
        ),
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
    .showHelpOnFail(true)

  const args = await argParser.parse()

  const [command] = args._

  switch (command) {
    case 'list':
      return list()

    case 'deploy':
      return deploy({
        command: args._[1],
        services: args.services,
      })

    case 'sync-photos':
      return syncPhotos({
        dest: args.dest,
        email: args.email,
      })

    case '*':
      argParser.showHelp()
  }
}

main()
