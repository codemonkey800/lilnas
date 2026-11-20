import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

import { Injectable } from '@nestjs/common'

import { EnvKeys } from 'src/env'

const DEFAULT_BIN = '/usr/local/bin/icloudpd'
const DEFAULT_KILL_GRACE_MS = 10_000

// icloudpd gets a small allowlist rather than this process's whole
// environment, which carries the database password and the Immich API key.
const PASSTHROUGH_ENV = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TZ',
  'TMPDIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
]

export interface IcloudpdExit {
  code: number | null
  signal: string | null
}

export interface IcloudpdProcess {
  pid: number
  exited: Promise<IcloudpdExit>
  stop(): Promise<void>
}

export interface SpawnOptions {
  // Called once per output line, stdout and stderr merged. It must not throw;
  // if it does the error is swallowed so the child's output keeps draining.
  onLine(line: string): void
  // How long stop() waits after SIGTERM before SIGKILL. Default 10 s.
  killGraceMs?: number
}

interface BaseArgs {
  appleId: string
  cookieDir: string
}

function buildBaseArgs({ appleId, cookieDir }: BaseArgs): string[] {
  return [
    '--username',
    appleId,
    '--cookie-directory',
    cookieDir,
    '--no-progress-bar',
    '--log-level',
    'info',
  ]
}

// Run icloudpd's login step: the web UI asks for the password and the
// two-factor code, then the process exits with a session cookie on disk.
export function buildAuthArgs(opts: BaseArgs): string[] {
  return [
    ...buildBaseArgs(opts),
    '--auth-only',
    '--password-provider',
    'webui',
    '--mfa-provider',
    'webui',
  ]
}

// Run a download with the stored session. No webui flags: if the session is
// gone icloudpd fails fast (EOFError) instead of waiting for a person.
export function buildDownloadArgs(
  opts: BaseArgs & { directory: string; recent?: number },
): string[] {
  const args = [...buildBaseArgs(opts), '--directory', opts.directory]
  if (opts.recent !== undefined) {
    if (!Number.isInteger(opts.recent) || opts.recent < 1) {
      throw new RangeError('recent must be a positive integer')
    }
    args.push('--recent', String(opts.recent))
  }
  return args
}

@Injectable()
export class ProcessService {
  spawnIcloudpd(args: string[], opts: SpawnOptions): IcloudpdProcess {
    const bin = process.env[EnvKeys.ICLOUDPD_BIN] || DEFAULT_BIN
    // NODE_ENV is only named because the ProcessEnv type requires it; the
    // Python binary ignores it.
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: process.env.NODE_ENV ?? 'production',
    }
    for (const key of PASSTHROUGH_ENV) {
      const value = process.env[key]
      if (value !== undefined) env[key] = value
    }

    const child = spawn(bin, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    })

    // A failed spawn (missing binary, EACCES) leaves pid undefined and emits
    // 'error' on the next tick. Handle it so it cannot become an uncaught
    // exception, and fail the call itself.
    child.on('error', () => undefined)
    if (child.pid === undefined) {
      throw new Error(`could not start icloudpd at ${bin}`)
    }
    const pid = child.pid

    const onLine = (line: string): void => {
      try {
        opts.onLine(line)
      } catch {
        // see SpawnOptions.onLine
      }
    }
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream, crlfDelay: Infinity }).on('line', onLine)
    }

    // 'close' rather than 'exit': it fires after both pipes have drained, so
    // every line has reached onLine by the time `exited` resolves.
    const exited = new Promise<IcloudpdExit>(resolve => {
      child.once('close', (code, signal) => resolve({ code, signal }))
    })
    let finished = false
    void exited.then(() => {
      finished = true
    })

    const killGraceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS
    const stop = async (): Promise<void> => {
      if (finished) return
      child.kill('SIGTERM')
      let timer: NodeJS.Timeout | undefined
      const timedOut = new Promise<'timeout'>(resolve => {
        timer = setTimeout(() => resolve('timeout'), killGraceMs)
      })
      const outcome = await Promise.race([
        exited.then(() => 'exited'),
        timedOut,
      ])
      clearTimeout(timer)
      if (outcome === 'timeout') {
        child.kill('SIGKILL')
        await exited
      }
    }

    return { pid, exited, stop }
  }
}
