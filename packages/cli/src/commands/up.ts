import { BaseServiceCommand } from '../base-service-command'

export class Up extends BaseServiceCommand {
  static override description = 'Bring up services with docker-compose up -d'

  static override examples = [
    '<%= config.bin %> up',
    '<%= config.bin %> up --apps',
    '<%= config.bin %> up --services',
    '<%= config.bin %> up tdr-bot download',
  ]

  static override flags = BaseServiceCommand.baseFlags

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(Up)
    const dryRun = flags['dry-run']
    const { services, composeFile } = this.resolveServices(
      flags,
      argv as string[],
    )

    if (services.length > 0) {
      this.log(`Bringing up services: ${services.join(' ')}`)
    } else {
      this.log('Bringing up all services')
    }

    this.runDockerCompose({ composeFile, args: ['up', '-d'], services, dryRun })
  }
}
