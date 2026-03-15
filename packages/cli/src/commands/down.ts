import { BaseServiceCommand } from '../base-service-command'

export class Down extends BaseServiceCommand {
  static override description =
    'Bring down services with docker-compose down --rmi all -v'

  static override examples = [
    '<%= config.bin %> down',
    '<%= config.bin %> down --apps',
    '<%= config.bin %> down --services',
    '<%= config.bin %> down tdr-bot download',
  ]

  static override flags = BaseServiceCommand.baseFlags

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(Down)
    const dryRun = flags['dry-run']
    const { services, composeFile } = this.resolveServices(
      flags,
      argv as string[],
    )

    if (services.length > 0) {
      this.log(`Bringing down services: ${services.join(' ')}`)
    } else {
      this.log('Bringing down all services')
    }

    this.runDockerCompose({
      composeFile,
      args: ['down', '--rmi', 'all', '-v'],
      services,
      dryRun,
    })
  }
}
