import { match } from 'ts-pattern'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { dev } from './commands/dev'
import { down } from './commands/down'
import { list } from './commands/list'
import { redeploy } from './commands/redeploy'
import { syncPhotos } from './commands/sync-photos'
import { up } from './commands/up'
import { getServices } from './utils'

async function main() {
  const services = await getServices()
  const devServices = await getServices({ dev: true })

  const argParser = yargs(hideBin(process.argv))
    .command('ls', 'Lists all services')
    .command(
      'dev [command]',
      'Manage dev environment',
      args =>
        args
          .command('ls', 'Lists all apps with dev mode')
          .command('ps [services...]', 'Shows status of services', args =>
            args
              .positional('services', {
                array: true,
                choices: devServices,
                type: 'string',
              })
              .option('all', {
                alias: 'a',
                description: 'Show all containers (default shows just running)',
                type: 'boolean',
              })
              .option('quiet', {
                alias: 'q',
                description: 'Only show container IDs',
                type: 'boolean',
              })
              .option('filter', {
                description:
                  'Filter services by a property (e.g. status=running)',
                type: 'string',
              }),
          )
          .command(
            'shell [command]',
            'Start a shell within the container',
            args =>
              args.positional('shellCommand', {
                type: 'string',
                description: 'Command to run in shell',
              }),
          )
          .command(
            'sync-deps',
            'Syncronizes npm dependencies from within the dev environment',
          )
          .command('*', 'Pass-through to docker-compose', args =>
            args.strict(false),
          )
          .help(false), // Disable yargs built-in help for dev command
    )
    .command('up [services...]', 'Deploys a service', args =>
      args.positional('services', {
        array: true,
        choices: services,
        type: 'string',
      }),
    )
    .command('down [services...]', 'Brings down a service', args =>
      args
        .positional('services', {
          array: true,
          choices: services,
          type: 'string',
        })
        .option('all', {
          default: false,
          description: 'Deletes all images instead of just local ones.',
          type: 'boolean',
        }),
    )
    .command('redeploy [services...]', 'Redeploys a service', args =>
      args
        .positional('services', { type: 'string', choices: services })
        .option('all', {
          default: false,
          description: 'Deletes all images instead of just local ones.',
          type: 'boolean',
        }),
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
        ...args,
        command: args._[1],
        shellCommand: args.command,
      }),
    )
    .with('up', () => up(args))
    .with('down', () => down(args))
    .with('redeploy', () => redeploy(args))
    .with('sync-photos', () => syncPhotos(args))
    .otherwise(() => argParser.showHelp())
}

main()
