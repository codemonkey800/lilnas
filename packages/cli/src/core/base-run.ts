import { execSync } from 'node:child_process'

import { Args, Command } from '@oclif/core'

import { ensureDockerImages } from 'src/core/docker-images.js'
import {
  getComposeFile,
  getMonorepoRoot,
  type ServiceMode,
} from 'src/services/discovery.js'

export default abstract class BaseRunCommand extends Command {
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
      strict: false,
    })
    const extraArgs = (argv as string[]).slice(1)

    ensureDockerImages(this.mode, [args.service], msg => this.log(msg))

    const root = getMonorepoRoot()
    const composeFile = getComposeFile(this.mode)
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
