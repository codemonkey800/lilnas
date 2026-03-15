import { Command, Flags } from '@oclif/core'

import { isDockerComposeAvailable, runDockerCompose } from './utils/docker'
import { getComposeFile, getMonorepoRoot } from './utils/paths'
import { listAppServices, listInfraServices } from './utils/services'

export abstract class BaseServiceCommand extends Command {
  static override strict = false

  static override baseFlags = {
    apps: Flags.boolean({
      description: 'Target only app services (from apps/*/deploy.yml)',
      exclusive: ['services'],
    }),
    'dry-run': Flags.boolean({
      description:
        'Print the docker-compose command(s) that would be run without executing them',
    }),
    services: Flags.boolean({
      description: 'Target only infrastructure services (from infra/*.yml)',
      exclusive: ['apps'],
    }),
  }

  /**
   * Resolves the list of services to operate on based on flags and positional args.
   * Validates that flags and positional services are not mixed.
   */
  protected resolveServices(
    flags: { apps?: boolean; services?: boolean },
    argv: string[],
  ): { services: string[]; composeFile: string } {
    if (!isDockerComposeAvailable()) {
      this.error('docker-compose is not installed or not in PATH', { exit: 1 })
    }

    const root = getMonorepoRoot()
    const composeFile = getComposeFile(root)

    const useApps = flags.apps === true
    const useInfra = flags.services === true

    // Filter out flag-like strings from raw argv to get positional service names
    const positionalServices = argv.filter(a => !a.startsWith('--'))

    if (positionalServices.length > 0 && (useApps || useInfra)) {
      this.error(
        'Cannot specify both --apps/--services flags and specific service names',
        { exit: 1 },
      )
    }

    let resolvedServices: string[] = []

    if (useApps) {
      resolvedServices = listAppServices(root)
    } else if (useInfra) {
      resolvedServices = listInfraServices(root)
    } else if (positionalServices.length > 0) {
      resolvedServices = positionalServices
    }

    return { services: resolvedServices, composeFile }
  }

  protected runDockerCompose(
    opts: Parameters<typeof runDockerCompose>[0],
  ): void {
    try {
      runDockerCompose(opts)
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err), { exit: 1 })
    }
  }

  /**
   * Like runDockerCompose but returns false instead of exiting on failure,
   * allowing callers to decide how to handle a non-zero exit.
   */
  protected tryRunDockerCompose(
    opts: Parameters<typeof runDockerCompose>[0],
  ): boolean {
    try {
      runDockerCompose(opts)
      return true
    } catch (err) {
      this.warn(err instanceof Error ? err.message : String(err))
      return false
    }
  }
}
