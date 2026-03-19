import { BaseServiceCommand } from '../base-service-command'

export class Logs extends BaseServiceCommand {
  static override description =
    'Follow logs for services with docker compose logs -f'

  static override examples = [
    '<%= config.bin %> logs',
    '<%= config.bin %> logs --apps',
    '<%= config.bin %> logs --services',
    '<%= config.bin %> logs tdr-bot download',
  ]

  static override strict = false
  static override flags = BaseServiceCommand.baseFlags

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(Logs)
    const dryRun = flags['dry-run']
    const { services, composeFile } = this.resolveServices(
      flags,
      argv as string[],
    )

    if (services.length > 0) {
      this.log(`Following logs for services: ${services.join(' ')}`)
    } else {
      this.log('Following logs for all services')
    }

    this.runDockerCompose({
      composeFile,
      args: ['logs', '-f'],
      services,
      dryRun,
    })
  }
}
