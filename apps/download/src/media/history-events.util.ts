/**
 * Radarr/Sonarr history, normalized: job outcomes come from the history
 * events `/api/v3/history/since` reports rather than from a download
 * vanishing out of the queue. This file is pure - the poller reads history,
 * hands the records to `normalizeHistory`, and links each `grabbed` event's
 * `downloadId` to the job `claimGrab` picks.
 *
 * Wire facts this relies on (Radarr 6.4 / Sonarr 4.0, Sonarr v5 noted):
 * - `eventType` is a camelCase string (`grabbed`, `downloadFolderImported`,
 *   ...), but the numeric enum form is accepted too, defensively.
 * - Nulls are omitted, and every `data` value is a string.
 * - `data.downloadUrl` on a grab carries the indexer's API key, so `data` is
 *   never copied wholesale - only the keys below are read.
 * - `/history/since` sorts by `date` alone, at second precision, and ids are
 *   not monotonic within a second - so the result is re-sorted here.
 */
import type { ShowScope } from '@lilnas/utils/download/types'
import {
  DownloadJobStatus,
  DownloadType,
  isTerminalDownloadJobStatus,
} from '@lilnas/utils/download/types'

import { historyValue } from './release-history.util'

export type ArrApp = 'radarr' | 'sonarr'

export type ArrEventKind =
  | 'grabbed'
  | 'imported'
  | 'failed'
  | 'manualFailed'
  | 'ignored'

/** One history record this app acts on, stripped to the fields it reads. */
export interface ArrEvent {
  app: ArrApp
  /** The history record's own id - with `date`, the sort key. */
  id: number
  kind: ArrEventKind
  /** As the wire sent it (ISO 8601, second precision). */
  date: string
  downloadId: string
  /** Radarr only. */
  movieId?: number
  /** Sonarr only. */
  seriesId?: number
  /** Sonarr only. */
  episodeId?: number
  /** Sonarr only, and only when the record carried its `episode`. */
  seasonNumber?: number
  /** Sonarr only, and only when the record carried its `episode`. */
  episodeNumber?: number
  /** `data.message` - a failure's reason, or "Manually ignored". */
  message?: string
  /**
   * Whether a human picked the release (`data.releaseSource` is
   * `InteractiveSearch`). Only a grab carries `releaseSource`, so this is
   * undefined on every other kind - look the grab up for a failure.
   */
  interactive?: boolean
}

/**
 * Structural subset of Radarr's and Sonarr's generated `HistoryResource`,
 * like `HistoryRecordLike`, except `eventType` also admits the numeric enum
 * form. Both SDK types assign to it unchanged.
 */
export interface ArrHistoryRecord {
  data?: { [key: string]: string | null } | null
  date?: string
  downloadId?: string | null
  /** Sonarr only, present when requested with `includeEpisode=true`. */
  episode?: { episodeNumber?: number; seasonNumber?: number } | null
  episodeId?: number
  eventType?: string | number
  id?: number
  movieId?: number
  seriesId?: number
}

/**
 * What `claimGrab` needs of an open job - every field is one the poller can
 * fill from a job row.
 */
export interface ClaimableJob {
  createdAt: Date | string
  id: string
  /** Shows only: absent (or null) means the whole series. */
  scope?: ShowScope | null
  status: DownloadJobStatus
  type: DownloadType
  /**
   * When this app sent Radarr/Sonarr the search or grab command for the
   * job, if it has. A job whose command predates the grab is the likelier
   * cause of it.
   */
  upstreamCommandAt?: Date | string | null
  /** Radarr's movieId or Sonarr's seriesId; null while unresolved. */
  upstreamId: number | null
}

/** The wire's `eventType` strings this app acts on. */
const STRING_KINDS: Readonly<Record<string, ArrEventKind>> = {
  downloadFailed: 'failed',
  downloadFolderImported: 'imported',
  downloadIgnored: 'ignored',
  grabbed: 'grabbed',
}

/**
 * The numeric enum values, per app - they differ for `ignored` (Radarr 9,
 * Sonarr 7), and Radarr 7 is `movieFolderImported`, which this ignores.
 */
const NUMERIC_KINDS: Readonly<
  Record<ArrApp, Readonly<Record<number, ArrEventKind>>>
> = {
  radarr: { 1: 'grabbed', 3: 'imported', 4: 'failed', 9: 'ignored' },
  sonarr: { 1: 'grabbed', 3: 'imported', 4: 'failed', 7: 'ignored' },
}

const MANUALLY_FAILED_MESSAGE = 'Manually marked as failed'
const AUTOMATIC_FAILURE_SOURCE = 'Failed Download Handling'
const INTERACTIVE_SOURCE = 'InteractiveSearch'

/**
 * How late a job's `createdAt` may trail a grab and still own it: the job
 * row can be written a moment after the request that caused the grab.
 */
export const CLAIM_CREATED_AT_SLACK_MS = 5_000

/** The open statuses a job can be grabbed in. */
const CLAIMABLE_STATUSES: ReadonlySet<DownloadJobStatus> = new Set([
  DownloadJobStatus.Requested,
  DownloadJobStatus.Searching,
  // A season's second grab arrives while the first is still in flight.
  DownloadJobStatus.Downloading,
  DownloadJobStatus.Importing,
  // Claimed so the poller can see the grab and remove it too.
  DownloadJobStatus.Cancelling,
])

/**
 * The records this app acts on, as events sorted by `(date, id)`.
 *
 * Dropped: every other event type (renames, deletes, folder imports,
 * `unknown`), and any record without a `downloadId`, an `id` or a parseable
 * `date` - nothing could link it to a job or order it.
 */
export function normalizeHistory(
  app: ArrApp,
  records: readonly ArrHistoryRecord[],
): ArrEvent[] {
  const events: { event: ArrEvent; time: number }[] = []

  for (const record of records) {
    const event = normalizeRecord(app, record)
    if (event) events.push({ event, time: Date.parse(event.date) })
  }

  return events
    .sort((a, b) => a.time - b.time || a.event.id - b.event.id)
    .map(({ event }) => event)
}

function normalizeRecord(
  app: ArrApp,
  record: ArrHistoryRecord,
): ArrEvent | undefined {
  const { date, downloadId, id } = record
  if (!downloadId || id == null || !date || Number.isNaN(Date.parse(date))) {
    return undefined
  }

  const baseKind = kindOf(app, record.eventType)
  if (!baseKind) return undefined

  // `historyValue` reads case-insensitively and treats '' as absent; only
  // `data` is handed over, so nothing else about the record can leak in.
  const bag = { data: record.data }
  const message = historyValue(bag, 'message')
  const source = historyValue(bag, 'source')
  const releaseSource = historyValue(bag, 'releaseSource')

  const kind =
    baseKind === 'failed' && isManualFailure(message, source)
      ? 'manualFailed'
      : baseKind

  const event: ArrEvent = { app, date, downloadId, id, kind }

  if (app === 'radarr') {
    if (record.movieId != null) event.movieId = record.movieId
  } else {
    if (record.seriesId != null) event.seriesId = record.seriesId
    if (record.episodeId != null) event.episodeId = record.episodeId
    // `!= null`, not truthiness - season 0 is Sonarr's specials season.
    if (record.episode?.seasonNumber != null) {
      event.seasonNumber = record.episode.seasonNumber
    }
    if (record.episode?.episodeNumber != null) {
      event.episodeNumber = record.episode.episodeNumber
    }
  }

  if (message != null) event.message = message
  if (releaseSource != null) {
    event.interactive = releaseSource === INTERACTIVE_SOURCE
  }

  return event
}

function kindOf(
  app: ArrApp,
  eventType: string | number | undefined,
): ArrEventKind | undefined {
  if (typeof eventType === 'number') return NUMERIC_KINDS[app][eventType]
  if (eventType == null) return undefined
  if (/^\d+$/.test(eventType)) return NUMERIC_KINDS[app][Number(eventType)]
  return Object.hasOwn(STRING_KINDS, eventType)
    ? STRING_KINDS[eventType]
    : undefined
}

/**
 * A human marked it failed: Radarr/Sonarr v4 say so in the message; Sonarr
 * v5 adds `data.source`, which names the failed-download handler ("Sonarr
 * Failed Download Handling") for an automatic failure and something else
 * for a manual one.
 */
function isManualFailure(
  message: string | undefined,
  source: string | undefined,
): boolean {
  return (
    message === MANUALLY_FAILED_MESSAGE ||
    (source != null && !source.endsWith(AUTOMATIC_FAILURE_SOURCE))
  )
}

/**
 * The job a `grabbed` event belongs to, or `undefined` when none can claim
 * it (an upstream grab - adoption's business). Called once per event, so
 * the per-episode grabs of one season pack each resolve independently -
 * and, sharing their title, season and date, to the same job.
 *
 * A job is a candidate when it is open with the event's type and title,
 * its scope covers the event, its status is one a grab can arrive in, and
 * it was created no later than `CLAIM_CREATED_AT_SLACK_MS` after the grab.
 * Among candidates: a job whose upstream command predates the grab, then
 * the narrowest scope (episode < season < series), then the oldest.
 */
export function claimGrab(
  event: ArrEvent,
  openJobs: readonly ClaimableJob[],
): string | undefined {
  if (event.kind !== 'grabbed') return undefined

  const eventTime = Date.parse(event.date)
  const type = event.app === 'radarr' ? DownloadType.Movie : DownloadType.Show
  const upstreamId = event.app === 'radarr' ? event.movieId : event.seriesId
  if (upstreamId == null || Number.isNaN(eventTime)) return undefined

  const candidates = openJobs.filter(
    job =>
      !isTerminalDownloadJobStatus(job.status) &&
      job.type === type &&
      job.upstreamId === upstreamId &&
      coversEvent(job, event) &&
      CLAIMABLE_STATUSES.has(job.status) &&
      toMs(job.createdAt) <= eventTime + CLAIM_CREATED_AT_SLACK_MS,
  )

  const ranked = candidates
    .map(job => ({
      commanded: commandedBefore(job.upstreamCommandAt, eventTime),
      createdAt: toMs(job.createdAt),
      job,
      width: scopeWidth(job),
    }))
    .sort(
      (a, b) =>
        Number(b.commanded) - Number(a.commanded) ||
        a.width - b.width ||
        a.createdAt - b.createdAt ||
        a.job.id.localeCompare(b.job.id),
    )

  return ranked[0]?.job.id
}

/**
 * Mirrors `matchesScope` (./queue-status.util.ts), except a season-scoped
 * job cannot claim an event that doesn't say its season - it can't be
 * proven to cover it.
 */
function coversEvent(job: ClaimableJob, event: ArrEvent): boolean {
  if (job.type === DownloadType.Movie) return true

  const scope = job.scope
  if (scope?.episodeId != null) return event.episodeId === scope.episodeId

  // `!= null`, not truthiness - season 0 is Sonarr's specials season.
  if (scope?.seasonNumber != null) {
    return (
      event.seasonNumber != null && event.seasonNumber === scope.seasonNumber
    )
  }

  return true
}

/** 0 episode (and every movie), 1 season, 2 whole series. */
function scopeWidth(job: ClaimableJob): number {
  if (job.type === DownloadType.Movie) return 0
  if (job.scope?.episodeId != null) return 0
  if (job.scope?.seasonNumber != null) return 1
  return 2
}

/**
 * Compared at the event's own (whole-second) precision: a command sent at
 * 12:00:00.400 can cause a grab the wire dates 12:00:00.
 */
function commandedBefore(
  commandAt: Date | string | null | undefined,
  eventTime: number,
): boolean {
  if (commandAt == null) return false
  const time = toMs(commandAt)
  return !Number.isNaN(time) && Math.floor(time / 1000) * 1000 <= eventTime
}

function toMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value)
}
