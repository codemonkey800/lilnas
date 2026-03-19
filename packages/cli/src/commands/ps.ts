import { BaseServiceCommand } from '../base-service-command'

export class Ps extends BaseServiceCommand {
  static override description = 'Show status of services with docker compose ps'

  static override examples = [
    '<%= config.bin %> ps',
    '<%= config.bin %> ps --apps',
    '<%= config.bin %> ps --services',
    '<%= config.bin %> ps tdr-bot download',
  ]

  static override strict = false
  static override flags = BaseServiceCommand.baseFlags

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(Ps)
    const dryRun = flags['dry-run']
    const { services, composeFile } = this.resolveServices(
      flags,
      argv as string[],
    )

    this.runDockerCompose({ composeFile, args: ['ps'], services, dryRun })
  }
}
