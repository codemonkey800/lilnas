import { Flags } from '@oclif/core'

import { BaseCommand, sharedFlags } from 'src/utils/base-command.js'
import { checkDockerCompose, composeUp } from 'src/utils/docker-compose.js'
import { findProjectRoot, getComposeFile } from 'src/utils/service-discovery.js'

export default class Up extends BaseCommand {
  static override description = 'Bring up services with docker-compose up'

  static override examples = [
    {
      command: '<%= config.bin %> <%= command.id %>',
      description: 'Bring up all services (attached)',
    },
    {
      command: '<%= config.bin %> <%= command.id %> -d',
      description: 'Bring up all services (detached)',
    },
    {
      command: '<%= config.bin %> <%= command.id %> --apps',
      description: 'Bring up all package services',
    },
    {
      command: '<%= config.bin %> <%= command.id %> --services',
      description: 'Bring up all infrastructure services',
    },
    {
      command: '<%= config.bin %> <%= command.id %> tdr-bot download',
      description: 'Bring up specific services',
    },
  ]

  static override flags = {
    ...sharedFlags,
    detach: Flags.boolean({
      char: 'd',
      default: false,
      description: 'Run containers in the background (detached mode)',
    }),
  }

  static override strict = false // Allow variadic args for service names

  async run(): Promise<void> {
    await checkDockerCompose()

    const { argv, flags } = await this.parse(Up)
    const services = await this.getTargetServices(flags, argv as string[])
    const composeFile = getComposeFile(this.devMode, findProjectRoot())

    if (services.length > 0) {
      this.log(`Bringing up services: ${services.join(', ')}`)
    } else {
      this.log('Bringing up all services')
    }

    await composeUp({
      composeFile,
      detach: flags.detach,
      services: services.length > 0 ? services : undefined,
    })
  }
}
