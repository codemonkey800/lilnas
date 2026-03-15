import { BaseServiceCommand } from '../base-service-command'

export class Redeploy extends BaseServiceCommand {
  static override description = 'Redeploy services (bring down then up)'

  static override examples = [
    '<%= config.bin %> redeploy',
    '<%= config.bin %> redeploy --apps',
    '<%= config.bin %> redeploy --services',
    '<%= config.bin %> redeploy tdr-bot download',
  ]

  static override flags = BaseServiceCommand.baseFlags

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(Redeploy)
    const dryRun = flags['dry-run']
    const { services, composeFile } = this.resolveServices(
      flags,
      argv as string[],
    )

    this.log('Redeploying services...\n')

    if (services.length > 0) {
      this.log(`Bringing down services: ${services.join(' ')}`)
    } else {
      this.log('Bringing down all services')
    }

    const downOk = this.tryRunDockerCompose({
      composeFile,
      args: ['down', '--rmi', 'all', '-v'],
      services,
      dryRun,
    })

    if (!downOk) {
      this.warn('down step failed — continuing to bring services up anyway')
    }

    this.log('')

    if (services.length > 0) {
      this.log(`Bringing up services: ${services.join(' ')}`)
    } else {
      this.log('Bringing up all services')
    }

    this.runDockerCompose({ composeFile, args: ['up', '-d'], services, dryRun })
  }
}
