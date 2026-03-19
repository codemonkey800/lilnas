import { Command, Flags } from '@oclif/core'

import { runSshCommand } from '../../utils/ssh'

export class RemoteUpdate extends Command {
  static override description =
    'Pull the latest changes from git on the remote server'

  static override examples = ['<%= config.bin %> remote update']

  static override flags = {
    'dry-run': Flags.boolean({
      description:
        'Print the ssh command that would be run without executing it',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(RemoteUpdate)
    const dryRun = flags['dry-run']

    this.log('Pulling latest changes on remote server...')

    const steps: Array<{ label: string; command: string }> = [
      { label: 'git pull', command: 'git pull origin main' },
      { label: 'pnpm install', command: 'pnpm install' },
      {
        label: 'build CLI',
        command: 'pnpm --filter @lilnas/cli build',
      },
    ]

    for (const { label, command } of steps) {
      this.log(`\n[${label}]`)
      try {
        runSshCommand({ command, dryRun })
      } catch (err) {
        this.error(err instanceof Error ? err.message : String(err), {
          exit: 1,
        })
      }
    }
  }
}
