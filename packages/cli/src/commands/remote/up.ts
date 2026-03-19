import { BaseRemoteCommand } from '../../base-remote-command'

export class RemoteUp extends BaseRemoteCommand {
  static override description = 'Bring up services on the remote server'

  static override examples = [
    '<%= config.bin %> remote up',
    '<%= config.bin %> remote up --apps',
    '<%= config.bin %> remote up --services',
    '<%= config.bin %> remote up tdr-bot download',
  ]

  static override strict = false
  static override flags = BaseRemoteCommand.baseFlags

  protected remoteSubcommand = 'up'

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(RemoteUp)
    this.runRemote(flags, argv as string[])
  }
}
