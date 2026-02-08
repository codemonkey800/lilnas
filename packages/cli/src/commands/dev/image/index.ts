import { execSync } from 'node:child_process'

import BaseCommand from 'src/core/base-command.js'
import {
  computeLockfileHash,
  getImageLockfileHash,
  IMAGE_NAME,
} from 'src/core/docker-images.js'
import { getMonorepoRoot } from 'src/services/discovery.js'

export default class DevImage extends BaseCommand {
  static override description = 'Show status of the lilnas-dev Docker image'

  async run(): Promise<void> {
    await this.parse(DevImage)
    try {
      const info = execSync(
        `docker image inspect ${IMAGE_NAME} --format '{{.Id}} {{.Size}} {{.Created}}'`,
        { encoding: 'utf-8' },
      ).trim()
      const parts = info.split(' ')
      const id = parts[0] ?? 'unknown'
      const sizeBytes = parts[1] ?? '0'
      const created = parts[2] ?? 'unknown'
      const sizeMB = (Number(sizeBytes) / 1_000_000).toFixed(1)

      const root = getMonorepoRoot()
      const imageHash = getImageLockfileHash(IMAGE_NAME)
      const currentHash = computeLockfileHash(root)
      const hashMatch =
        imageHash && currentHash === imageHash ? 'up to date' : 'outdated'

      this.verbose(`Monorepo root: ${root}`)
      this.verbose(`Full image ID: ${id}`)
      this.verbose(`Size bytes: ${sizeBytes}`)
      this.verbose(`Current lockfile hash: ${currentHash}`)
      this.verbose(`Image lockfile hash: ${imageHash ?? 'none'}`)
      this.verbose(`Hash status: ${hashMatch}`)

      this.log(`${IMAGE_NAME} image:`)
      this.log(`  ID:      ${id.slice(0, 19)}`)
      this.log(`  Size:    ${sizeMB} MB`)
      this.log(`  Created: ${created}`)
      this.log(
        `  Lock:    ${imageHash ? imageHash.slice(0, 12) : 'none'} (${hashMatch})`,
      )
    } catch {
      this.log(`${IMAGE_NAME} image not found.`)
    }
  }
}
