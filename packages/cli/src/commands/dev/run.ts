import { execSync, spawn } from 'node:child_process'

import BaseComposeCommand from 'src/core/base-compose.js'
import { ensureDockerImages } from 'src/core/docker-images.js'
import {
  getComposeFile,
  getMonorepoRoot,
  type ServiceMode,
} from 'src/services/discovery.js'

export default class DevRun extends BaseComposeCommand {
  static override description =
    'Run dev Docker Compose services in the foreground and clean up on exit'

  override composeArgs = ['up']
  override mode: ServiceMode = 'dev'
  protected override needsImageCheck = true

  override async run(): Promise<void> {
    const targets = await this.resolveTargets()

    const root = getMonorepoRoot()
    const composeFile = getComposeFile(this.mode)
    this.verbose(`Monorepo root: ${root}`)
    this.verbose(`Compose file: ${composeFile}`)

    if (this.needsImageCheck) {
      ensureDockerImages(
        this.mode,
        targets,
        msg => this.log(msg),
        msg => this.verbose(msg),
      )
    }

    const args = ['-f', composeFile, 'up', ...targets]
    this.log(`Running: docker-compose ${args.join(' ')}`)

    const child = spawn('docker-compose', args, {
      cwd: root,
      stdio: 'inherit',
    })

    // Prevent Node from exiting on SIGINT/SIGTERM — let docker-compose
    // receive the signal directly from the TTY and handle graceful shutdown.
    // We just need Node to stay alive until the child exits so cleanup runs.
    const signalHandler = () => {}
    process.on('SIGINT', signalHandler)
    process.on('SIGTERM', signalHandler)

    return new Promise<void>(resolve => {
      child.on('exit', code => {
        process.removeListener('SIGINT', signalHandler)
        process.removeListener('SIGTERM', signalHandler)

        this.cleanup(composeFile, root, targets)

        resolve()
        process.exit(code ?? 0)
      })
    })
  }

  private cleanup(composeFile: string, root: string, targets: string[]): void {
    try {
      if (targets.length > 0) {
        // Remove only the specific services that were started
        const rmArgs = ['-f', composeFile, 'rm', '-sf', ...targets]
        this.log(`Cleaning up: docker-compose ${rmArgs.join(' ')}`)
        execSync(`docker-compose ${rmArgs.join(' ')}`, {
          cwd: root,
          stdio: 'inherit',
        })
      } else {
        // No specific targets — bring down everything
        this.log('Cleaning up: docker-compose down')
        execSync(`docker-compose -f ${composeFile} down`, {
          cwd: root,
          stdio: 'inherit',
        })
      }
    } catch {
      this.verbose('Cleanup command failed, continuing...')
    }
  }
}
