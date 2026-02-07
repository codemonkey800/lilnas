import { execSync } from 'node:child_process'

import { Command } from '@oclif/core'

import { IMAGE_NAME } from 'src/core/docker-images.js'

export default class DevImage extends Command {
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

      this.log(`${IMAGE_NAME} image:`)
      this.log(`  ID:      ${id.slice(0, 19)}`)
      this.log(`  Size:    ${sizeMB} MB`)
      this.log(`  Created: ${created}`)
    } catch {
      this.log(`${IMAGE_NAME} image not found.`)
    }
  }
}
