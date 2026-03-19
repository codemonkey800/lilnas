import { BaseRemoteCommand } from '../../base-remote-command'

export class RemoteRedeploy extends BaseRemoteCommand {
  static override description =
    'Redeploy services (bring down then up) on the remote server'

  static override examples = [
    '<%= config.bin %> remote redeploy',
    '<%= config.bin %> remote redeploy --apps',
    '<%= config.bin %> remote redeploy --services',
    '<%= config.bin %> remote redeploy tdr-bot download',
  ]

  static override strict = false
  static override flags = BaseRemoteCommand.baseFlags

  protected remoteSubcommand = 'redeploy'

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(RemoteRedeploy)
    this.runRemote(flags, argv as string[])
  }
}
