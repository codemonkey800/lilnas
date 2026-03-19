import { BaseRemoteCommand } from '../../base-remote-command'

export class RemotePs extends BaseRemoteCommand {
  static override description = 'Show status of services on the remote server'

  static override examples = [
    '<%= config.bin %> remote ps',
    '<%= config.bin %> remote ps --apps',
    '<%= config.bin %> remote ps --services',
    '<%= config.bin %> remote ps tdr-bot download',
  ]

  static override strict = false
  static override flags = BaseRemoteCommand.baseFlags

  protected remoteSubcommand = 'ps'

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(RemotePs)
    this.runRemote(flags, argv as string[])
  }
}
