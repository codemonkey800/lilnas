import { Command, Flags } from '@oclif/core'
import * as readline from 'readline'

import { getStorageMounts, StorageMount } from '../../utils/compose'
import { runSshCommand, runSshCommandCapture } from '../../utils/ssh'

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
    const matchingMounts = mounts.filter(m => m.hostPath === deletePath)

    if (matchingMounts.length === 0) {
      this.error(
        `Path "${deletePath}" is not a known storage mount. Run without --delete to see all known mounts.`,
        { exit: 1 },
      )
    }

    const services = [...new Set(matchingMounts.map(m => m.service))]
    this.log(`Path: ${deletePath}`)
    this.log(`Used by service(s): ${services.join(', ')}`)

    if (services.length > 1) {
      this.warn(
        `This path is shared by multiple services (${services.join(', ')}). ` +
          'Deleting it will affect all of them.',
      )
    }

    if (!yes && !dryRun) {
      const confirmed = await confirm(
        `Are you sure you want to permanently delete "${deletePath}" on the remote server?`,
      )
      if (!confirmed) {
        this.log('Aborted.')
        return
      }
    }

    this.log(`\nDeleting ${deletePath} on remote...`)
    runSshCommand({ command: `rm -rf "${deletePath}"`, dryRun })
    this.log('Done.')
  }
}
