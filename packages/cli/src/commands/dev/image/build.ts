import { execSync } from 'node:child_process'

import { Command, Flags } from '@oclif/core'

import { IMAGE_NAME } from 'src/core/docker-images.js'
import { getMonorepoRoot } from 'src/services/discovery.js'

export default class DevImageBuild extends Command {
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
    const noCache = flags['no-cache'] ? ' --no-cache' : ''
    const cmd = `docker build -f Dockerfile.dev -t ${IMAGE_NAME}${noCache} .`

    this.log(`Building ${IMAGE_NAME} image...`)
    this.log(`Running: ${cmd}`)
    execSync(cmd, { cwd: root, stdio: 'inherit' })
    this.log(`${IMAGE_NAME} image built successfully.`)
  }
}
