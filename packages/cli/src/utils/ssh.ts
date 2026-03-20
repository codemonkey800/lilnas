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
  capture?: boolean
}

export interface SshStdinResult {
  stdout: string
  stderr: string
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
 * When capture is true, suppresses terminal output and returns captured stdout/stderr instead.
 * Throws if the SSH command exits with a non-zero status (includes stderr in error when capturing).
 */
export function runSshCommandWithStdin(
  options: SshOptionsWithStdin & { capture: true },
): SshStdinResult
export function runSshCommandWithStdin(
  options: SshOptionsWithStdin & { capture?: false },
): void
export function runSshCommandWithStdin({
  command,
  host = DEFAULT_HOST,
  dryRun = false,
  stdin,
  capture = false,
}: SshOptionsWithStdin): SshStdinResult | void {
  const remoteCmd = `cd ${REMOTE_DIR} && ${command}`

  if (dryRun) {
    console.log(`[dry-run] ssh ${host} '${remoteCmd}'`)
    return capture ? { stdout: '', stderr: '' } : undefined
  }

  const result = spawnSync('ssh', [host, remoteCmd], {
    input: stdin,
    stdio: capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'],
    encoding: capture ? 'utf8' : undefined,
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    const detail = capture && result.stderr ? `\n${result.stderr}` : ''
    throw new Error(
      `ssh command exited with status ${result.status ?? 1}${detail}`,
    )
  }

  if (capture) {
    return {
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    }
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
