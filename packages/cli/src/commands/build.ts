import { BaseServiceCommand } from '../base-service-command'

export class Build extends BaseServiceCommand {
  static override description = 'Build Docker images for services'

  static override examples = [
    '<%= config.bin %> build',
    '<%= config.bin %> build --apps',
    '<%= config.bin %> build --services',
    '<%= config.bin %> build tdr-bot download',
  ]

  static override flags = BaseServiceCommand.baseFlags

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(Build)
    const dryRun = flags['dry-run']
    const { services, composeFile } = this.resolveServices(
      flags,
      argv as string[],
    )

    if (services.length > 0) {
      this.log(`Building services: ${services.join(' ')}`)
    } else {
      this.log('Building all services')
    }

    this.runDockerCompose({ composeFile, args: ['build'], services, dryRun })
  }
}
