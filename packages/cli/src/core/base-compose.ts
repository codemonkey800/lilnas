import { execSync } from 'node:child_process'

import { Flags } from '@oclif/core'

import BaseCommand from 'src/core/base-command.js'
import { ensureDockerImages } from 'src/core/docker-images.js'
import {
  discoverAppServices,
  discoverInfraServices,
  getComposeFile,
  getMonorepoRoot,
  type ServiceMode,
} from 'src/services/discovery.js'

export default abstract class BaseComposeCommand extends BaseCommand {
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
      baseFlags: ctor.baseFlags,
      flags: ctor.flags,
      strict: false,
    })
    const positionalArgs = argv as string[]

    this.verbose(`Mode: ${this.mode}`)
    this.verbose(
      `Flags: apps=${String(flags.apps ?? false)}, services=${String(flags.services ?? false)}`,
    )
    this.verbose(`Positional args: ${JSON.stringify(positionalArgs)}`)

    if ((flags.apps || flags.services) && positionalArgs.length > 0) {
      this.error(
        'Cannot specify both --apps/--services and individual service names',
      )
    }

    let targets: string[]
    if (flags.apps) {
      targets = discoverAppServices(this.mode)
      this.verbose(`Discovered app services: ${JSON.stringify(targets)}`)
    } else if (flags.services) {
      targets = discoverInfraServices(this.mode)
      this.verbose(`Discovered infra services: ${JSON.stringify(targets)}`)
    } else {
      targets = positionalArgs
    }

    this.verbose(`Resolved targets: ${JSON.stringify(targets)}`)
    return targets
  }

  async run(): Promise<void> {
    const targets = await this.resolveTargets()

    const root = getMonorepoRoot()
    const composeFile = getComposeFile(this.mode)
    this.verbose(`Monorepo root: ${root}`)
    this.verbose(`Compose file: ${composeFile}`)

    this.verbose(`Image check needed: ${String(this.needsImageCheck)}`)
    if (this.needsImageCheck) {
      ensureDockerImages(
        this.mode,
        targets,
        msg => this.log(msg),
        msg => this.verbose(msg),
      )
    }

    const cmd = ['docker-compose', '-f', composeFile, ...this.composeArgs]

    if (targets.length > 0) {
      cmd.push(...targets)
    }

    this.log(`Running: ${cmd.join(' ')}`)
    execSync(cmd.join(' '), { cwd: root, stdio: 'inherit' })
  }
}
