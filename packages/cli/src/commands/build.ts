import { BaseCommand, sharedFlags } from 'src/utils/base-command.js'
import { checkDockerCompose, composeBuild } from 'src/utils/docker-compose.js'
import { findProjectRoot, getComposeFile } from 'src/utils/service-discovery.js'

export default class Build extends BaseCommand {
  static override description = 'Build Docker images for services'

  static override strict = false

  static override examples = [
    {
      command: '<%= config.bin %> <%= command.id %>',
      description: 'Build all services',
    },
    {
      command: '<%= config.bin %> <%= command.id %> --apps',
      description: 'Build all package services',
    },
    {
      command: '<%= config.bin %> <%= command.id %> --services',
      description: 'Build all infra services',
    },
    {
      command: '<%= config.bin %> <%= command.id %> tdr-bot download',
      description: 'Build specific services',
    },
  ]

  static override flags = {
    ...sharedFlags,
  }

  async run(): Promise<void> {
    await checkDockerCompose()

    const { flags, argv } = await this.parse(Build)
    const services = await this.getTargetServices(flags, argv as string[])
    const composeFile = getComposeFile(this.devMode, findProjectRoot())

    if (services.length > 0) {
      this.log(`Building services: ${services.join(', ')}`)
    } else {
      this.log('Building all services')
    }

    await composeBuild({
      composeFile,
      services: services.length > 0 ? services : undefined,
    })
  }
}
