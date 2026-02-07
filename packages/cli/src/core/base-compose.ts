import { execSync } from 'node:child_process'

import { Command, Flags } from '@oclif/core'

import { ensureDockerImages } from 'src/core/docker-images.js'
import {
  discoverAppServices,
  discoverInfraServices,
  getComposeFile,
  getMonorepoRoot,
  type ServiceMode,
} from 'src/services/discovery.js'

export default abstract class BaseComposeCommand extends Command {
  static override flags = {
    apps: Flags.boolean({
      description: 'Target all app services (from packages/*/deploy.yml)',
      exclusive: ['services'],
    }),

    services: Flags.boolean({
      description: 'Target all infra services (from infra/*.yml)',
      exclusive: ['apps'],
    }),
  }

  static override strict = false

  abstract composeArgs: string[]
  abstract mode: ServiceMode
  protected needsImageCheck = false

  async resolveTargets(): Promise<string[]> {
    const ctor = this.constructor as typeof BaseComposeCommand
    const { argv, flags } = await this.parse({
      flags: ctor.flags,
      strict: false,
    })
    const positionalArgs = argv as string[]

    if ((flags.apps || flags.services) && positionalArgs.length > 0) {
      this.error(
        'Cannot specify both --apps/--services and individual service names',
      )
    }

    if (flags.apps) return discoverAppServices(this.mode)
    if (flags.services) return discoverInfraServices(this.mode)
    return positionalArgs
  }

  async run(): Promise<void> {
    const targets = await this.resolveTargets()

    if (this.needsImageCheck) {
      ensureDockerImages(this.mode, targets, msg => this.log(msg))
    }

    const root = getMonorepoRoot()
    const composeFile = getComposeFile(this.mode)
    const cmd = ['docker-compose', '-f', composeFile, ...this.composeArgs]

    if (targets.length > 0) {
      cmd.push(...targets)
    }

    this.log(`Running: ${cmd.join(' ')}`)
    execSync(cmd.join(' '), { cwd: root, stdio: 'inherit' })
  }
}
