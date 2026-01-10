import { BaseCommand, sharedFlags } from 'src/utils/base-command.js'
import { checkDockerCompose, composeDown } from 'src/utils/docker-compose.js'
import { findProjectRoot, getComposeFile } from 'src/utils/service-discovery.js'

export default class Down extends BaseCommand {
  static override description = 'Bring down services with docker-compose down'

  static override strict = false

  static override examples = [
    {
      command: '<%= config.bin %> <%= command.id %>',
      description: 'Bring down all services',
    },
    {
      command: '<%= config.bin %> <%= command.id %> --apps',
      description: 'Bring down all package services',
    },
    {
      command: '<%= config.bin %> <%= command.id %> --services',
      description: 'Bring down all infra services',
    },
    {
      command: '<%= config.bin %> <%= command.id %> tdr-bot download',
      description: 'Bring down specific services',
    },
  ]

  static override flags = {
    ...sharedFlags,
  }

  async run(): Promise<void> {
    await checkDockerCompose()

    const { flags, argv } = await this.parse(Down)
    const services = await this.getTargetServices(flags, argv as string[])
    const composeFile = getComposeFile(this.devMode, findProjectRoot())

    if (services.length > 0) {
      this.log(`Bringing down services: ${services.join(', ')}`)
    } else {
      this.log('Bringing down all services')
    }

    await composeDown({
      composeFile,
      services: services.length > 0 ? services : undefined,
    })
  }
}
