import { spawnSync } from 'child_process'

const DEFAULT_HOST = 'lilnas.io'
const REMOTE_DIR = 'lilnas'

export interface SshOptions {
  command: string
  host?: string
  dryRun?: boolean
}

export interface SshOptionsWithStdin extends SshOptions {
  stdin: string
}

/**
 * Runs a command on the remote server via SSH, streaming output to the terminal.
 * When dryRun is true, prints the command that would be run without executing it.
 * Throws if the SSH command exits with a non-zero status.
 */
export function runSshCommand({
  command,
  host = DEFAULT_HOST,
  dryRun = false,
}: SshOptions): void {
  const remoteCmd = `cd ${REMOTE_DIR} && ${command}`

  if (dryRun) {
    console.log(`[dry-run] ssh ${host} '${remoteCmd}'`)
    return
  }

  const result = spawnSync('ssh', [host, remoteCmd], { stdio: 'inherit' })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`ssh command exited with status ${result.status ?? 1}`)
  }
}

/**
 * Runs a command on the remote server via SSH, streaming output to the terminal,
 * and pipes the provided stdin string to the remote process (e.g. for sudo -S).
 * When dryRun is true, prints the command that would be run without executing it.
 * Throws if the SSH command exits with a non-zero status.
 */
export function runSshCommandWithStdin({
  command,
  host = DEFAULT_HOST,
  dryRun = false,
  stdin,
}: SshOptionsWithStdin): void {
  const remoteCmd = `cd ${REMOTE_DIR} && ${command}`

  if (dryRun) {
    console.log(`[dry-run] ssh ${host} '${remoteCmd}'`)
    return
  }

  const result = spawnSync('ssh', [host, remoteCmd], {
    input: stdin,
    stdio: ['pipe', 'inherit', 'inherit'],
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`ssh command exited with status ${result.status ?? 1}`)
  }
}

/**
 * Runs a command on the remote server via SSH and returns stdout as a string.
 * When dryRun is true, prints the command that would be run and returns an empty string.
 * Throws if the SSH command exits with a non-zero status.
 */
export function runSshCommandCapture({
  command,
  host = DEFAULT_HOST,
  dryRun = false,
}: SshOptions): string {
  const remoteCmd = `cd ${REMOTE_DIR} && ${command}`

  if (dryRun) {
    console.log(`[dry-run] ssh ${host} '${remoteCmd}'`)
    return ''
  }

  const result = spawnSync('ssh', [host, remoteCmd], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`ssh command exited with status ${result.status ?? 1}`)
  }

  return result.stdout ?? ''
}
