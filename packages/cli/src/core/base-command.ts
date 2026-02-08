import { Command, Flags } from '@oclif/core'

export default abstract class BaseCommand extends Command {
  static override baseFlags = {
    verbose: Flags.boolean({
      char: 'v',
      default: false,
      description: 'Print detailed debug information',
    }),
  }

  protected isVerbose = false

  override async init(): Promise<void> {
    await super.init()
    // Parse only baseFlags with strict:false so positional args and
    // command-specific flags don't cause "unexpected argument" errors.
    const { flags } = await this.parse({
      baseFlags: BaseCommand.baseFlags,
      flags: {},
      strict: false,
    })
    this.isVerbose = flags.verbose

    if (this.isVerbose) {
      this.verbose(`CLI version: ${this.config.version}`)
      this.verbose(`Node: ${process.version}`)
      this.verbose(`Platform: ${process.platform} ${process.arch}`)
      this.verbose(`CWD: ${process.cwd()}`)
    }
  }

  protected verbose(msg: string): void {
    if (this.isVerbose) {
      this.log(`[verbose] ${msg}`)
    }
  }
}
