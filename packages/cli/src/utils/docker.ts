import { spawnSync } from 'child_process'

export interface DockerComposeOptions {
  composeFile: string
  args: string[]
  services?: string[]
  dryRun?: boolean
}

type DockerComposeCmd = ['docker', 'compose'] | ['docker-compose']

let cachedCmd: DockerComposeCmd | null = null

/**
 * Detects which docker compose variant is available, preferring the v2 plugin
 * (`docker compose`) and falling back to the deprecated v1 standalone binary
 * (`docker-compose`).
 */
export function resolveDockerComposeCmd(): DockerComposeCmd | null {
  if (cachedCmd) return cachedCmd
  if (
    spawnSync('docker', ['compose', 'version'], { stdio: 'pipe' }).status === 0
  ) {
    cachedCmd = ['docker', 'compose']
    return cachedCmd
  }
  if (
    spawnSync('docker-compose', ['--version'], { stdio: 'pipe' }).status === 0
  ) {
    cachedCmd = ['docker-compose']
    return cachedCmd
  }
  return null
}

export function isDockerComposeAvailable(): boolean {
  return resolveDockerComposeCmd() !== null
}

/**
 * Runs a docker compose command, streaming output to the terminal.
 * When dryRun is true, prints the command that would be run without executing it.
 * Throws if docker compose is not found or the command exits with a non-zero status.
 */
export function runDockerCompose({
  composeFile,
  args,
  services = [],
  dryRun = false,
}: DockerComposeOptions): void {
  const cmd = resolveDockerComposeCmd()
  if (!cmd) {
    throw new Error('docker compose is not installed or not in PATH')
  }

  const [bin, ...baseArgs] = cmd
  const cmdArgs = [...baseArgs, '-f', composeFile, ...args, ...services]

  if (dryRun) {
    console.log(`[dry-run] ${bin} ${cmdArgs.join(' ')}`)
    return
  }

  const result = spawnSync(bin, cmdArgs, { stdio: 'inherit' })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `docker compose exited with status ${result.status ?? 1}: ${[bin, ...cmdArgs].join(' ')}`,
    )
  }
}
