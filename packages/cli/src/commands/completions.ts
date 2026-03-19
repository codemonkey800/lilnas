import { Command, Flags } from '@oclif/core'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const FISH_COMPLETIONS_DIR = path.join(
  os.homedir(),
  '.config',
  'fish',
  'completions',
)
const FISH_COMPLETIONS_FILE = path.join(FISH_COMPLETIONS_DIR, 'lilnas.fish')

export class Completions extends Command {
  static override description =
    'Manage fish shell completions for the lilnas CLI'

  static override examples = [
    '<%= config.bin %> completions',
    '<%= config.bin %> completions --install',
    '<%= config.bin %> completions --uninstall',
  ]

  static override flags = {
    install: Flags.boolean({
      description: `Install completions to ${FISH_COMPLETIONS_FILE}`,
      exclusive: ['uninstall'],
    }),
    uninstall: Flags.boolean({
      description: `Remove completions from ${FISH_COMPLETIONS_FILE}`,
      exclusive: ['install'],
    }),
  }

  private getScriptPath(): string {
    // Resolve relative to this file's location in both dev (src/) and
    // production (dist/) builds so the completions/ directory is always found
    // at the package root.
    const fromSrc = path.resolve(
      __dirname,
      '..',
      '..',
      'completions',
      'lilnas.fish',
    )
    const fromDist = path.resolve(__dirname, '..', 'completions', 'lilnas.fish')

    if (fs.existsSync(fromSrc)) return fromSrc
    if (fs.existsSync(fromDist)) return fromDist

    this.error(
      'Could not locate the lilnas.fish completion script. ' +
        'Try rebuilding the package with `pnpm build`.',
    )
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Completions)
    const scriptPath = this.getScriptPath()

    if (flags.install) {
      fs.mkdirSync(FISH_COMPLETIONS_DIR, { recursive: true })
      fs.copyFileSync(scriptPath, FISH_COMPLETIONS_FILE)
      this.log(`Installed fish completions to ${FISH_COMPLETIONS_FILE}`)
      this.log(
        'Reload your fish shell or run `source ~/.config/fish/config.fish` to activate.',
      )
      return
    }

    if (flags.uninstall) {
      if (!fs.existsSync(FISH_COMPLETIONS_FILE)) {
        this.warn(`No completions file found at ${FISH_COMPLETIONS_FILE}`)
        return
      }
      fs.rmSync(FISH_COMPLETIONS_FILE)
      this.log(`Removed fish completions from ${FISH_COMPLETIONS_FILE}`)
      return
    }

    // Default: print the completion script to stdout
    this.log(fs.readFileSync(scriptPath, 'utf8'))
  }
}
