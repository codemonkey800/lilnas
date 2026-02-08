import { execSync } from 'node:child_process'

import BaseComposeCommand from 'src/core/base-compose.js'
import { ensureDockerImages } from 'src/core/docker-images.js'
import type { ServiceMode } from 'src/services/discovery.js'
import { getComposeFile, getMonorepoRoot } from 'src/services/discovery.js'

export default class Redeploy extends BaseComposeCommand {
  static override description =
    'Redeploy services by running down followed by up'

  override composeArgs = []
  override mode: ServiceMode = 'prod'

  override async run(): Promise<void> {
    const targets = await this.resolveTargets()

    this.verbose(`Redeploy targets: ${JSON.stringify(targets)}`)

    ensureDockerImages(
      this.mode,
      targets,
      msg => this.log(msg),
      msg => this.verbose(msg),
    )
    const root = getMonorepoRoot()
    const composeFile = getComposeFile(this.mode)
    const targetArgs = targets.length > 0 ? ` ${targets.join(' ')}` : ''

    this.verbose(`Monorepo root: ${root}`)
    this.verbose(`Compose file: ${composeFile}`)

    const downCmd = `docker-compose -f ${composeFile} down --rmi all -v${targetArgs}`
    this.log(`Running: ${downCmd}`)
    execSync(downCmd, { cwd: root, stdio: 'inherit' })

    const upCmd = `docker-compose -f ${composeFile} up -d${targetArgs}`
    this.log(`Running: ${upCmd}`)
    execSync(upCmd, { cwd: root, stdio: 'inherit' })
  }
}
