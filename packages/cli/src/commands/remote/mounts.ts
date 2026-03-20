import { Command, Flags } from '@oclif/core'
import * as path from 'path'
import * as readline from 'readline'

import { getStorageMounts, StorageMount } from '../../utils/compose'
import { runSshCommandCapture, runSshCommandWithStdin } from '../../utils/ssh'

interface MountWithExists extends StorageMount {
  exists: boolean
  size: string | null
}

function buildExistenceCheckScript(paths: string[]): string {
  const checks = paths
    .map(
      p =>
        `[ -d "${p}" ] && echo "EXISTS:$(du -sh "${p}" 2>/dev/null | cut -f1):${p}" || echo "MISSING:${p}"`,
    )
    .join('; ')
  return checks
}

interface MountInfo {
  exists: boolean
  size: string | null
}

function parseExistenceOutput(output: string): Map<string, MountInfo> {
  const result = new Map<string, MountInfo>()
  for (const line of output.trim().split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('EXISTS:')) {
      const rest = trimmed.slice('EXISTS:'.length)
      const colonIdx = rest.indexOf(':')
      if (colonIdx !== -1) {
        const size = rest.slice(0, colonIdx)
        const path = rest.slice(colonIdx + 1)
        result.set(path, { exists: true, size })
      }
    } else if (trimmed.startsWith('MISSING:')) {
      result.set(trimmed.slice('MISSING:'.length), {
        exists: false,
        size: null,
      })
    }
  }
  return result
}

function padEnd(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length)
}

function renderTable(mounts: MountWithExists[]): void {
  const COL_SERVICE = 18
  const COL_HOST = 42
  const COL_CONTAINER = 38
  const COL_SOURCE = 20
  const COL_EXISTS = 10
  const COL_SIZE = 10

  const header =
    padEnd('SERVICE', COL_SERVICE) +
    padEnd('HOST PATH', COL_HOST) +
    padEnd('CONTAINER PATH', COL_CONTAINER) +
    padEnd('SOURCE', COL_SOURCE) +
    padEnd('EXISTS', COL_EXISTS) +
    'SIZE'

  const separator = '─'.repeat(
    COL_SERVICE + COL_HOST + COL_CONTAINER + COL_SOURCE + COL_EXISTS + COL_SIZE,
  )

  console.log(header)
  console.log(separator)

  for (const m of mounts) {
    const existsLabel = m.exists ? 'yes' : 'no'
    const sizeLabel = m.size ?? '—'
    const row =
      padEnd(m.service, COL_SERVICE) +
      padEnd(m.hostPath, COL_HOST) +
      padEnd(m.containerPath + (m.readOnly ? ' (ro)' : ''), COL_CONTAINER) +
      padEnd(m.source, COL_SOURCE) +
      padEnd(existsLabel, COL_EXISTS) +
      sizeLabel

    console.log(row)
  }
}

// Characters that must never appear in a storage path sent to a remote shell.
// eslint-disable-next-line no-control-regex
const DANGEROUS_CHARS = /[\x00\n\r`$|;&><(){}!'"\s]/

/**
 * Validates that `input` is a safe, absolute path rooted under /storage/ with
 * at least one subdirectory level. Throws with a descriptive message otherwise.
 *
 * Security checks performed:
 *   1. Reject dangerous shell characters (injection / control chars)
 *   2. POSIX-normalize to collapse any .. or . traversal segments
 *   3. Verify the normalized path starts with /storage/
 *   4. Require at least 3 path segments (/storage/<category>/<name>) to
 *      prevent accidentally wiping a top-level storage category
 */
function validateStoragePath(input: string): string {
  if (DANGEROUS_CHARS.test(input)) {
    throw new Error(
      `Unsafe path rejected: "${input}" contains shell-unsafe characters.`,
    )
  }

  const normalized = path.posix.normalize(input)

  if (!normalized.startsWith('/storage/')) {
    throw new Error(
      `Path "${input}" is not under /storage/ (normalized: "${normalized}"). ` +
        'Only /storage/ paths are permitted.',
    )
  }

  // Segments after splitting: ['', 'storage', '<category>', '<name>', ...]
  // We require at least 3 segments beyond the leading empty string.
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length < 3) {
    throw new Error(
      `Path "${normalized}" is too shallow. ` +
        'At least three path components are required (e.g. /storage/app-data/service).',
    )
  }

  return normalized
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return new Promise(resolve => {
    rl.question(`${question} [y/N] `, answer => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}

/**
 * Prompts the user for a sudo password without echoing the input.
 * Returns the entered password string.
 */
async function promptPassword(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Cannot prompt for password: stdin is not a TTY.'))
      return
    }

    process.stdout.write(prompt)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    let password = ''

    const onData = (char: string) => {
      if (char === '\r' || char === '\n') {
        process.stdin.setRawMode(false)
        process.stdin.pause()
        process.stdin.removeListener('data', onData)
        process.stdout.write('\n')
        resolve(password)
      } else if (char === '\u0003') {
        // Ctrl-C
        process.stdin.setRawMode(false)
        process.stdin.pause()
        process.stdin.removeListener('data', onData)
        process.stdout.write('\n')
        reject(new Error('Password prompt cancelled.'))
      } else if (char === '\u007f' || char === '\b') {
        // Backspace
        password = password.slice(0, -1)
      } else {
        password += char
      }
    }

    process.stdin.on('data', onData)
  })
}

export class RemoteMounts extends Command {
  static override description =
    'List storage mounts across all services, check existence on remote, or delete a mount directory'

  static override examples = [
    '<%= config.bin %> remote mounts',
    '<%= config.bin %> remote mounts --delete /storage/app-data/sonarr',
    '<%= config.bin %> remote mounts --delete /storage/app-data/sonarr --yes',
    '<%= config.bin %> remote mounts --dry-run',
  ]

  static override flags = {
    delete: Flags.string({
      description:
        'Host path of the mount directory to delete on the remote server',
      helpValue: 'PATH',
    }),
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip confirmation prompt when deleting',
    }),
    'dry-run': Flags.boolean({
      description:
        'Print the SSH commands that would be run without executing them',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(RemoteMounts)
    const dryRun = flags['dry-run']
    const deletePath = flags['delete']

    this.log('Parsing compose files...')
    const mounts = getStorageMounts()

    if (mounts.length === 0) {
      this.log('No /storage/ mounts found in compose files.')
      return
    }

    if (deletePath) {
      await this.runDelete(mounts, deletePath, { dryRun, yes: flags['yes'] })
    } else {
      await this.runList(mounts, { dryRun })
    }
  }

  private async runList(
    mounts: StorageMount[],
    { dryRun }: { dryRun: boolean },
  ): Promise<void> {
    const uniquePaths = [...new Set(mounts.map(m => m.hostPath))]

    this.log(
      `Checking ${uniquePaths.length} unique mount path(s) on remote...\n`,
    )

    const script = buildExistenceCheckScript(uniquePaths)
    const output = runSshCommandCapture({ command: script, dryRun })

    const infoMap = dryRun
      ? new Map<string, MountInfo>(
          uniquePaths.map(p => [p, { exists: false, size: null }]),
        )
      : parseExistenceOutput(output)

    const mountsWithExists: MountWithExists[] = mounts.map(m => {
      const info = infoMap.get(m.hostPath)
      return {
        ...m,
        exists: info?.exists ?? false,
        size: info?.size ?? null,
      }
    })

    renderTable(mountsWithExists)

    const missing = mountsWithExists.filter(m => !m.exists)
    if (missing.length > 0) {
      this.log(
        `\n${missing.length} mount(s) do not exist on the remote server.`,
      )
    }
  }

  private async runDelete(
    mounts: StorageMount[],
    deletePath: string,
    { dryRun, yes }: { dryRun: boolean; yes: boolean },
  ): Promise<void> {
    const validatedPath = validateStoragePath(deletePath)

    const matchingMounts = mounts.filter(m => m.hostPath === validatedPath)

    if (matchingMounts.length === 0) {
      this.error(
        `Path "${validatedPath}" is not a known storage mount. Run without --delete to see all known mounts.`,
        { exit: 1 },
      )
    }

    const services = [...new Set(matchingMounts.map(m => m.service))]
    this.log(`Path: ${validatedPath}`)
    this.log(`Used by service(s): ${services.join(', ')}`)

    if (services.length > 1) {
      this.warn(
        `This path is shared by multiple services (${services.join(', ')}). ` +
          'Deleting it will affect all of them.',
      )
    }

    if (!yes && !dryRun) {
      const confirmed = await confirm(
        `Are you sure you want to permanently delete "${validatedPath}" on the remote server?`,
      )
      if (!confirmed) {
        this.log('Aborted.')
        return
      }
    }

    let password = ''
    if (!dryRun) {
      password = await promptPassword(`[sudo] password for remote server: `)
    }

    this.log(`\nDeleting ${validatedPath} on remote...`)
    try {
      runSshCommandWithStdin({
        command: `sudo -S rm -rf "${validatedPath}"`,
        stdin: `${password}\n`,
        dryRun,
        capture: true,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.error(`Failed to delete "${validatedPath}":\n${message}`, {
        exit: 1,
      })
    }
    this.log('Done.')
  }
}
