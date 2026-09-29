/**
 * Command shapes shared by the Radarr and Sonarr services. Both *arrs run the
 * same command engine, so these are app-agnostic: each service maps its own
 * generated `CommandResource` onto them.
 */

/**
 * Where a command is in its lifecycle. Radarr and Sonarr use the same set;
 * `orphaned` is a command that was running when the *arr restarted.
 */
export type CommandStatus =
  | 'queued'
  | 'started'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'cancelled'
  | 'orphaned'

/**
 * What posting a command hands back - enough to look it up again later.
 *
 * `id` may belong to a command that was already queued: the *arrs de-dupe an
 * identical queued command (same name and body, trigger ignored) and return
 * the existing one instead of queueing a second.
 */
export interface CommandRef {
  id: number
  name: string
  queuedAt: string
}

/**
 * One read of a command's state.
 *
 * - `result` is `successful`, `unsuccessful` or `unknown`. A command read
 *   back from the database (after it drops out of memory, ~5 min after it
 *   ends) always says `unknown` and carries no `message`.
 * - `trigger` is `unspecified`, `manual` or `scheduled`.
 * - `body` is the command's own parameters (`movieIds`, `seriesId`, ...).
 */
export interface CommandSnapshot {
  id: number
  name: string
  status: CommandStatus
  result?: string
  trigger?: string
  message?: string
  queued?: string
  started?: string
  ended?: string
  body: Record<string, unknown>
}
