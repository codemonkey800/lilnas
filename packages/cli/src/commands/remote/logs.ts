import { BaseRemoteCommand } from '../../base-remote-command'

export class RemoteLogs extends BaseRemoteCommand {
  static override description = 'Follow logs for services on the remote server'

  static override examples = [
    '<%= config.bin %> remote logs',
    '<%= config.bin %> remote logs --apps',
    '<%= config.bin %> remote logs --services',
    '<%= config.bin %> remote logs tdr-bot download',
  ]

  static override strict = false
  static override flags = BaseRemoteCommand.baseFlags

  protected remoteSubcommand = 'logs'

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(RemoteLogs)
    this.runRemote(flags, argv as string[])
  }
}
