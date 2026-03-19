import { BaseRemoteCommand } from '../../base-remote-command'

export class RemoteBuild extends BaseRemoteCommand {
  static override description =
    'Build Docker images for services on the remote server'

  static override examples = [
    '<%= config.bin %> remote build',
    '<%= config.bin %> remote build --apps',
    '<%= config.bin %> remote build --services',
    '<%= config.bin %> remote build tdr-bot download',
  ]

  static override strict = false
  static override flags = BaseRemoteCommand.baseFlags

  protected remoteSubcommand = 'build'

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(RemoteBuild)
    this.runRemote(flags, argv as string[])
  }
}
