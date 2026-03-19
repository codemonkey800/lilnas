import { BaseRemoteCommand } from '../../base-remote-command'

export class RemoteDown extends BaseRemoteCommand {
  static override description = 'Bring down services on the remote server'

  static override examples = [
    '<%= config.bin %> remote down',
    '<%= config.bin %> remote down --apps',
    '<%= config.bin %> remote down --services',
    '<%= config.bin %> remote down tdr-bot download',
  ]

  static override strict = false
  static override flags = BaseRemoteCommand.baseFlags

  protected remoteSubcommand = 'down'

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(RemoteDown)
    this.runRemote(flags, argv as string[])
  }
}
