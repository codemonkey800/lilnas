import type {
  CommandSnapshot,
  CommandStatus,
} from 'src/media/arr-command.types'

/** The statuses a Radarr/Sonarr command never leaves. */
const ENDED_STATUSES: ReadonlySet<CommandStatus> = new Set([
  'completed',
  'failed',
  'aborted',
  'cancelled',
  'orphaned',
])

/** `true` once a command has stopped running, whatever the outcome. */
export function isCommandEnded(command: CommandSnapshot): boolean {
  return ENDED_STATUSES.has(command.status)
}

/**
 * How `waitForCommand()` stopped:
 *
 * - `ended`: the command reached a final status (`command.status` says which).
 * - `missing`: the *arr has no record of the id (404) - nothing left to wait on.
 * - `timeout`: still queued or running at the deadline; `command` is the last
 *   read.
 */
export type CommandWaitResult =
  | { outcome: 'ended'; command: CommandSnapshot }
  | { outcome: 'missing' }
  | { outcome: 'timeout'; command: CommandSnapshot }

export interface WaitForCommandOptions {
  /** Delay between reads. */
  intervalMs: number
  /** Upper bound on the whole wait, measured from the first read. */
  timeoutMs: number
  /** Injectable for tests; defaults to a `setTimeout` promise. */
  sleep?: (ms: number) => Promise<void>
  /** Injectable for tests; defaults to `Date.now`. */
  now?: () => number
}

const defaultSleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Polls one Radarr/Sonarr command until it ends, disappears, or the deadline
 * passes - whichever comes first. Reads immediately, then every
 * `intervalMs`; never sleeps past the deadline.
 *
 * `getCommand` is the service's own (`RadarrService.getCommand` /
 * `SonarrService.getCommand`), which returns `null` for a 404. Any error it
 * throws propagates - deciding whether a failed read is fatal is the
 * caller's call.
 */
export async function waitForCommand(
  getCommand: (id: number) => Promise<CommandSnapshot | null>,
  id: number,
  {
    intervalMs,
    timeoutMs,
    sleep = defaultSleep,
    now = Date.now,
  }: WaitForCommandOptions,
): Promise<CommandWaitResult> {
  const deadline = now() + timeoutMs

  for (;;) {
    const command = await getCommand(id)

    if (!command) {
      return { outcome: 'missing' }
    }

    if (isCommandEnded(command)) {
      return { command, outcome: 'ended' }
    }

    const remaining = deadline - now()
    if (remaining <= 0) {
      return { command, outcome: 'timeout' }
    }

    await sleep(Math.min(intervalMs, remaining))
  }
}
