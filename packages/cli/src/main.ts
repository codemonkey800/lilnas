import { match } from 'ts-pattern'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { dev } from './commands/dev'
import { down } from './commands/down'
import { list } from './commands/list'
import { redeploy } from './commands/redeploy'
import { syncPhotos } from './commands/sync-photos'
import { up } from './commands/up'
import { getServices, getServicesWithDevMode } from './utils'

async function main() {
  const services = await getServices()
  const servicesWithDevMode = await getServicesWithDevMode()

  const argParser = yargs(hideBin(process.argv))
    .command('ls', 'Lists all services')
    .command('dev [command]', 'Manage dev environment', args =>
      args
        .command('build', 'Builds the dev environment')
        .command('down', 'Brings down resources used for the dev environment')
        .command('ls', 'Lists all apps with dev mode')
        .command('logs', 'Shows logs from container', args =>
          args.option('follow', {
            alias: 'f',
            description: 'Follows the log output',
            type: 'boolean',
          }),
        )
        .command(
          'up <service> [options]',
          'Starts up the dev environment',
          args =>
            args
              .positional('service', {
                type: 'string',
                choices: servicesWithDevMode,
                requiresArg: true,
                description: 'Service to start',
              })
              .option('port', {
                type: 'number',
                description: 'Port to expose on the container',
              })
              .option('detach', {
                alias: 'd',
                description: 'Detaches after starting the container',
                type: 'boolean',
              }),
        )
        .command(
          'sync-deps',
          'Syncronizes npm dependencies from within the dev environment',
        ),
    )
    .command('up [services...]', 'Deploys a service', args =>
      args.positional('services', { type: 'string', choices: services }),
    )
    .command('down [services...]', 'Brings down a service', args =>
      args.positional('services', { type: 'string', choices: services }),
    )
    .command('redeploy [services...]', 'Redeploys a service', args =>
      args.positional('services', { type: 'string', choices: services }),
    )
    .command(
      'sync-photos [options]',
      'Syncs iCloud photos to a local directory',
      args =>
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
    .with('ls', () => list())
    .with('dev', () =>
      dev({
        command: args._[1],
        follow: args.follow,
        port: args.port,
        service: args.service,
        detach: args.detach,
      }),
    )
    .with('up', () => up(args.services))
    .with('down', () => down(args.services))
    .with('redeploy', () => redeploy(args.services))
    .with('sync-photos', () =>
      syncPhotos({ dest: args.dest, email: args.email }),
    )
    .otherwise(() => argParser.showHelp())
}

main()
