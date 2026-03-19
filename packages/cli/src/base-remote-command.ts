import { Command, Flags } from '@oclif/core'

import { runSshCommand } from './utils/ssh'

export abstract class BaseRemoteCommand extends Command {
  static override strict = false

  static override baseFlags = {
    apps: Flags.boolean({
      description: 'Target only app services (from apps/*/deploy.yml)',
      exclusive: ['services'],
    }),
    'dry-run': Flags.boolean({
      description:
        'Print the ssh command that would be run without executing it',
    }),
    services: Flags.boolean({
      description: 'Target only infrastructure services (from infra/*.yml)',
      exclusive: ['apps'],
    }),
  }

  protected abstract remoteSubcommand: string

  /**
   * Builds the remote `lilnas <subcommand> [flags] [services...]` command string
   * from the parsed flags and positional argv.
   */
  protected buildRemoteCommand(
    flags: { apps?: boolean; services?: boolean },
    argv: string[],
  ): string {
    const parts: string[] = ['lilnas', this.remoteSubcommand]

    if (flags.apps) parts.push('--apps')
    if (flags.services) parts.push('--services')

    const positional = argv.filter(a => !a.startsWith('--'))
    parts.push(...positional)

    return parts.join(' ')
  }

  protected runRemote(
    flags: { apps?: boolean; services?: boolean; 'dry-run'?: boolean },
    argv: string[],
  ): void {
    const command = this.buildRemoteCommand(flags, argv)
    const dryRun = flags['dry-run']
    try {
      runSshCommand({ command, dryRun })
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err), { exit: 1 })
    }
  }
}
