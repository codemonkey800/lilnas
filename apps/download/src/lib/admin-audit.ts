import type { AuditAction, AuditLogEntry } from '@lilnas/utils/download/types'

import type { StatusTone } from 'src/lib/format'

/**
 * What an audit row's level column says, and the tint it says it in.
 *
 * `admin-dashboard.pug` draws a short uppercase level word (`DOWNLOAD`,
 * `ADMIN`, `FLAG`, `DELETE`…) next to every line, with the colour carrying the
 * meaning. The API has no `level` field — it has the closed `<subject>.<verb>`
 * {@link AuditAction} vocabulary — so the level is derived from the action here
 * rather than invented per row.
 */
export type AuditLevel = {
  /** The uppercase word in the level column. */
  label: string
  /** Which of the design system's tones tints it. */
  tone: StatusTone
}

/**
 * Every audit action's level, as a total `Record` rather than a `switch` with a
 * fallback — adding an action to `AUDIT_ACTIONS` upstream is then a type error
 * here instead of a row that silently renders as unlabelled grey.
 *
 * The tones follow the same reading `statusTone` uses elsewhere: `ok` for work
 * starting or arriving, `uv` for the machine or an admin acting, `warn` for an
 * intervention on something that already exists, `bad` for destruction, `mute`
 * for housekeeping.
 */
export const AUDIT_ACTION_LEVELS: Record<AuditAction, AuditLevel> = {
  'video.create': { label: 'DOWNLOAD', tone: 'ok' },
  'video.cancel': { label: 'CANCEL', tone: 'warn' },
  'video.pause': { label: 'PAUSE', tone: 'warn' },
  'video.resume': { label: 'RESUME', tone: 'uv' },
  'video.delete': { label: 'DELETE', tone: 'bad' },
  'movie.request': { label: 'REQUEST', tone: 'ok' },
  'movie.delete': { label: 'DELETE', tone: 'bad' },
  'show.request': { label: 'REQUEST', tone: 'ok' },
  'show.delete': { label: 'DELETE', tone: 'bad' },
  'media.delete_files': { label: 'DELETE', tone: 'bad' },
  'media.save_file': { label: 'SAVE', tone: 'uv' },
  'release.grab': { label: 'GRAB', tone: 'ok' },
  'release.replace': { label: 'REPLACE', tone: 'warn' },
  'file.flag_bad': { label: 'FLAG', tone: 'warn' },
  'file.unflag_bad': { label: 'UNFLAG', tone: 'uv' },
  'ytdlp.check_update': { label: 'UPDATE', tone: 'mute' },
  'media.manual_import': { label: 'IMPORT', tone: 'uv' },
  'media.discard_download': { label: 'DISCARD', tone: 'bad' },
  'movie.cancel': { label: 'CANCEL', tone: 'warn' },
  'show.cancel': { label: 'CANCEL', tone: 'warn' },
}

/** The level an audit row renders at. See {@link AUDIT_ACTION_LEVELS}. */
export function auditLevel(action: AuditAction): AuditLevel {
  return AUDIT_ACTION_LEVELS[action]
}

/**
 * What each action reads as in the sentence, in the past tense the log is
 * written in. Total for the same reason the level map is.
 */
export const AUDIT_ACTION_PHRASES: Record<AuditAction, string> = {
  'video.create': 'started a video download',
  'video.cancel': 'cancelled a video download',
  'video.pause': 'paused a video download',
  'video.resume': 'resumed a video download',
  'video.delete': 'deleted a video download',
  'movie.request': 'requested a movie',
  'movie.delete': 'deleted a movie download',
  'show.request': 'requested a show',
  'show.delete': 'deleted a show download',
  'media.delete_files': 'deleted files',
  'media.save_file': 'saved a file',
  'release.grab': 'grabbed a release',
  'release.replace': 'replaced a release',
  'file.flag_bad': 'flagged a release bad',
  'file.unflag_bad': 'cleared a bad-release flag',
  'ytdlp.check_update': 'checked for a yt-dlp update',
  'media.manual_import': 'manually imported files',
  'media.discard_download': 'discarded a stuck download',
  'movie.cancel': 'cancelled a movie download',
  'show.cancel': 'cancelled a show download',
}

/**
 * What a `null` actor is called.
 *
 * ⚠️ `AuditLogEntry.actor` is `null` for a **service** caller with no forwarded
 * identity — tdr-bot, the yt-dlp updater — and `origin` says which kind of null
 * it is (`'service'` expected, `'web'` a browser request that somehow arrived
 * without `X-Forwarded-User`). It is emphatically **not** the masked
 * attribution `DownloadJob.requester` uses the same `null` for on every other
 * page: nothing on `/admin` is masked, because `AdminGuard` is what makes true
 * attribution safe here. Rendering it as an anonymous or hidden *person* would
 * name a user who does not exist.
 */
export const AUDIT_SERVICE_LABEL = 'service'

/**
 * The label for an actor-shaped slot that has no actor. `'service'` for the
 * expected case; a `'web'` origin gets said out loud, because a browser request
 * that lost its identity header is a thing somebody should look at.
 */
export function auditActorLabel(origin: AuditLogEntry['origin']): string {
  return origin === 'service' ? AUDIT_SERVICE_LABEL : 'unattributed web request'
}

/**
 * What the row's action was done to, or `null` when the action has no target
 * (`ytdlp.check_update`).
 *
 * `targetType` and `targetId` are independently nullable on the wire, so both
 * are checked; a target id with no type still renders, because the id is the
 * useful half.
 */
export function describeAuditTarget(entry: AuditLogEntry): string | null {
  if (entry.targetId === null) {
    return null
  }

  return entry.targetType === null
    ? entry.targetId
    : `${entry.targetType} ${entry.targetId}`
}

/**
 * An audit row's `metadata` as formatted JSON, or `null` when there is nothing
 * to show.
 *
 * ⚠️ Deliberately *not* given a schema. `AuditLogEntrySchema` types this column
 * `Record<string, unknown>` on purpose — "per-action detail rendered as
 * key/value pairs, never branched on" — and putting a discriminated union in
 * front of it here would make every new action a frontend change before its
 * detail could be read at all. Two spaces, so a nested object stays legible in
 * a narrow column.
 *
 * An empty object answers `null`: a disclosure that opens onto `{}` is a
 * control that does nothing.
 */
export function formatAuditMetadata(
  metadata: AuditLogEntry['metadata'],
): string | null {
  if (metadata === null || Object.keys(metadata).length === 0) {
    return null
  }

  return JSON.stringify(metadata, null, 2)
}
