import { BaseCommand, sharedFlags } from 'src/utils/base-command.js'
import {
  checkDockerCompose,
  composeDown,
  composeUp,
} from 'src/utils/docker-compose.js'
import { findProjectRoot, getComposeFile } from 'src/utils/service-discovery.js'

export default class Deploy extends BaseCommand {
  static override description =
    'Deploy services (bring down then up in detached mode)'

  static override examples = [
    {
      command: '<%= config.bin %> <%= command.id %>',
      description: 'Deploy all services',
    },
    {
      command: '<%= config.bin %> <%= command.id %> --apps',
      description: 'Deploy all package services',
    },
    {
      command: '<%= config.bin %> <%= command.id %> --services',
      description: 'Deploy all infra services',
    },
    {
      command: '<%= config.bin %> <%= command.id %> tdr-bot download',
      description: 'Deploy specific services',
    },
  ]

  static override strict = false

  static override flags = {
    ...sharedFlags,
  }

  async run(): Promise<void> {
    await checkDockerCompose()

    const { flags, argv } = await this.parse(Deploy)
    const services = await this.getTargetServices(flags, argv as string[])
    const composeFile = getComposeFile(this.devMode, findProjectRoot())

    this.log('Deploying services...')
    this.log('')

    // First bring down
    if (services.length > 0) {
      this.log(`Bringing down services: ${services.join(', ')}`)
    } else {
      this.log('Bringing down all services')
    }

    await composeDown({
      composeFile,
      services: services.length > 0 ? services : undefined,
    })

    this.log('')

    // Then bring up in detached mode
    if (services.length > 0) {
      this.log(`Bringing up services: ${services.join(', ')}`)
    } else {
      this.log('Bringing up all services')
    }

    await composeUp({
      composeFile,
      services: services.length > 0 ? services : undefined,
      detach: true, // Always detached for deploy
    })
  }
}
