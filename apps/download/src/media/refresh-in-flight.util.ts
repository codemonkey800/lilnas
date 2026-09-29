import { DownloadType } from '@lilnas/utils/download/types'

import type { CommandRef, CommandSnapshot } from './arr-command.types'
import { isCommandEnded } from './command-wait.util'

/** A refresh of one title that Radarr/Sonarr still have queued or running. */
export interface RefreshInFlight {
  /**
   * Whether it is the add-time refresh (`isNewMovie`/`isNewSeries`) - the
   * one Radarr/Sonarr queue themselves when a title is added.
   */
  isNew: boolean
  ref: CommandRef
}

/**
 * Each app's refresh command and the body fields that name its titles.
 * `seriesId` is Sonarr's older single-id form of `seriesIds`.
 */
const REFRESH_COMMANDS = {
  [DownloadType.Movie]: {
    idFields: ['movieIds'],
    isNewField: 'isNewMovie',
    name: 'RefreshMovie',
  },
  [DownloadType.Show]: {
    idFields: ['seriesIds', 'seriesId'],
    isNewField: 'isNewSeries',
    name: 'RefreshSeries',
  },
} as const

/** The title ids a command body names, from a list or a single id. */
function bodyIds(
  body: Record<string, unknown>,
  fields: readonly string[],
): ReadonlySet<number> {
  const ids = new Set<number>()

  for (const field of fields) {
    const value = body[field]
    const values: unknown[] = Array.isArray(value) ? value : [value]
    for (const item of values) {
      if (typeof item === 'number') ids.add(item)
    }
  }

  return ids
}

/**
 * The refresh of one title still queued or running in `commands` (a
 * `listCommands()` read), or `undefined` when there is none.
 *
 * What counts:
 *
 * - a `RefreshMovie`/`RefreshSeries` that has not ended (`queued` or
 *   `started`) and names `upstreamId` in its body;
 * - the add-time refresh (`isNew`) *and* a plain one - either re-saves a
 *   snapshot of the title read before its metadata fetch, undoing any
 *   monitor flag written while it runs;
 * - not a library-wide refresh (no ids - Radarr/Sonarr's scheduled one):
 *   it walks every title in turn and can run for many minutes, so waiting
 *   on it would stall a request on titles it has nothing to do with.
 *
 * With more than one, the add-time refresh wins - it is the one that
 * creates a new show's episodes.
 */
export function findRefreshInFlight(
  commands: readonly CommandSnapshot[],
  type: DownloadType.Movie | DownloadType.Show,
  upstreamId: number,
): RefreshInFlight | undefined {
  const { idFields, isNewField, name } = REFRESH_COMMANDS[type]
  let found: RefreshInFlight | undefined

  for (const command of commands) {
    if (
      command.name !== name ||
      isCommandEnded(command) ||
      !bodyIds(command.body, idFields).has(upstreamId)
    ) {
      continue
    }

    const isNew = command.body[isNewField] === true
    if (found && (found.isNew || !isNew)) continue

    found = {
      isNew,
      ref: {
        id: command.id,
        name: command.name,
        queuedAt: command.queued ?? new Date().toISOString(),
      },
    }
  }

  return found
}
