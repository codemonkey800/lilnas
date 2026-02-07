import { execSync } from 'node:child_process'

import {
  getComposeFile,
  getMonorepoRoot,
  type ServiceMode,
} from './discovery.js'

export interface ContainerStatus {
  state: string
  health: string
}

export function getContainerStatuses(
  mode: ServiceMode,
): Map<string, ContainerStatus> {
  const root = getMonorepoRoot()
  const composeFile = getComposeFile(mode)
  const statuses = new Map<string, ContainerStatus>()

  try {
    const output = execSync(
      `docker compose -f ${composeFile} ps --all --format json`,
      { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString()

    // docker compose ps --format json outputs NDJSON (one JSON object per line)
    for (const line of output.trim().split('\n')) {
      if (!line) continue

      const entry = JSON.parse(line) as {
        Service?: string
        State?: string
        Health?: string
      }

      if (entry.Service) {
        statuses.set(entry.Service, {
          state: entry.State ?? 'unknown',
          health: entry.Health ?? '',
        })
      }
    }
  } catch {
    // Docker not running or compose file not found — return empty map
  }

  return statuses
}

export function formatStatus(status: ContainerStatus | undefined): string {
  if (!status) return 'not created'

  const { state, health } = status
  if (health && health !== 'unknown' && health !== '') {
    return `${state} (${health})`
  }

  return state
}
