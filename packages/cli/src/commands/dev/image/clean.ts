import { execSync } from 'node:child_process'

import BaseCommand from 'src/core/base-command.js'
import { IMAGE_NAME } from 'src/core/docker-images.js'
import { getMonorepoRoot } from 'src/services/discovery.js'

export default class DevImageClean extends BaseCommand {
  static override description = 'Remove the lilnas-dev Docker image'

  async run(): Promise<void> {
    const root = getMonorepoRoot()

    this.verbose(`Monorepo root: ${root}`)
    this.verbose(`Target image: ${IMAGE_NAME}`)

    this.log(`Removing ${IMAGE_NAME} image...`)
    try {
      execSync(`docker rmi ${IMAGE_NAME}`, { cwd: root, stdio: 'inherit' })
      this.log(`${IMAGE_NAME} image removed.`)
    } catch {
      this.log(`${IMAGE_NAME} image not found, nothing to remove.`)
    }
  }
}
