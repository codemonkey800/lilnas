import { execSync } from 'node:child_process'

import { Args } from '@oclif/core'

import BaseCommand from 'src/core/base-command.js'
import { ensureDockerImages } from 'src/core/docker-images.js'
import {
  getComposeFile,
  getMonorepoRoot,
  type ServiceMode,
} from 'src/services/discovery.js'

export default abstract class BaseRunCommand extends BaseCommand {
  static override args = {
    service: Args.string({
      description: 'Service name to run (e.g. sync-db-push)',
      required: true,
    }),
  }

  static override strict = false

  abstract mode: ServiceMode

  async run(): Promise<void> {
    const ctor = this.constructor as typeof BaseRunCommand
    const { args, argv } = await this.parse({
      args: ctor.args,
      baseFlags: ctor.baseFlags,
      strict: false,
    })
    const extraArgs = (argv as string[]).slice(1)

    this.verbose(`Mode: ${this.mode}`)
    this.verbose(`Service: ${args.service}`)
    this.verbose(`Extra args: ${JSON.stringify(extraArgs)}`)

    const root = getMonorepoRoot()
    const composeFile = getComposeFile(this.mode)
    this.verbose(`Monorepo root: ${root}`)
    this.verbose(`Compose file: ${composeFile}`)

    ensureDockerImages(
      this.mode,
      [args.service],
      msg => this.log(msg),
      msg => this.verbose(msg),
    )

    const cmd = [
      'docker-compose',
      '-f',
      composeFile,
      'run',
      '--rm',
      args.service,
      ...extraArgs,
    ]

    this.log(`Running: ${cmd.join(' ')}`)
    execSync(cmd.join(' '), { cwd: root, stdio: 'inherit' })
  }
}
