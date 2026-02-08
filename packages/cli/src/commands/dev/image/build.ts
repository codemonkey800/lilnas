import { execSync } from 'node:child_process'

import { Flags } from '@oclif/core'

import BaseCommand from 'src/core/base-command.js'
import { computeLockfileHash, IMAGE_NAME } from 'src/core/docker-images.js'
import { getMonorepoRoot } from 'src/services/discovery.js'

export default class DevImageBuild extends BaseCommand {
  static override description = 'Build the lilnas-dev Docker image'

  static override flags = {
    'no-cache': Flags.boolean({
      description: 'Build without using Docker cache',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(DevImageBuild)
    const root = getMonorepoRoot()
    const hash = computeLockfileHash(root)
    const noCache = flags['no-cache'] ? ' --no-cache' : ''
    const cmd = `docker build -f Dockerfile.dev -t ${IMAGE_NAME} --label "lockfile.hash=${hash}"${noCache} .`

    this.verbose(`Monorepo root: ${root}`)
    this.verbose(`Lockfile hash: ${hash}`)
    this.verbose(`No-cache: ${String(flags['no-cache'])}`)

    this.log(`Building ${IMAGE_NAME} image...`)
    this.log(`Running: ${cmd}`)
    execSync(cmd, { cwd: root, stdio: 'inherit' })
    this.log(`${IMAGE_NAME} image built successfully.`)
  }
}
