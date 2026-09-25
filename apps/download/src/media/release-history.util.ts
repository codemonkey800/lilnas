import { ReleaseProtocolSchema } from '@lilnas/utils/download/schema'
import type { ReleaseProtocol } from '@lilnas/utils/download/types'

/**
 * Structural subset of Radarr's and Sonarr's (nominally distinct, but
 * field-compatible for what this reads) generated `HistoryResource` types -
 * just enough to walk a title's history back from a file on disk to the
 * release that produced it. Declared structurally, like
 * `PollableQueueItem`/`CommonReleaseResource`, so one join serves both
 * clients instead of branching per SDK type.
 */
export interface HistoryRecordLike {
  /**
   * Radarr and Sonarr both serialize this bag as `Dictionary<string,
   * string>`, so *every* value arrives as a string - `size: '4419036486'`,
   * `protocol: '1'`, `age: '0'`. Nothing in here is pre-parsed.
   */
  data?: { [key: string]: string | null } | null
  date?: string
  downloadId?: string | null
  /** Sonarr only: Radarr's history is per-movie and has no episode scope. */
  episodeId?: number
  eventType?: string
  sourceTitle?: string | null
}

/** A `grabbed` history record, joined to the file it eventually became. */
export interface GrabbedRelease {
  downloadId: string
  episodeId?: number
  guid: string
  indexer?: string
  indexerId?: number
  protocol?: ReleaseProtocol
  publishDate?: string
  releaseGroup?: string
  size?: number
  title: string
}

/**
 * The two event types this join cares about, matched as **strings** off the
 * response records.
 *
 * The SDK's `eventType` union (`'unknown' | 'grabbed' |
 * 'downloadFolderImported' | ...`) is *not* positional with the numeric wire
 * values the history endpoints accept as a filter - `downloadFolderImported`
 * is `3` on the wire, not `2`. Filtering on the string sidesteps that
 * mismatch entirely; never reintroduce a numeric comparison here.
 */
const GRABBED = 'grabbed'
const IMPORTED = 'downloadFolderImported'

/**
 * Positional map from the wire's numeric protocol to the shared enum, taken
 * from `ReleaseProtocolSchema` itself so the two can't drift: `0 ->
 * unknown`, `1 -> usenet`, `2 -> torrent`.
 */
const PROTOCOLS = ReleaseProtocolSchema.options

/**
 * Case-insensitive lookup into a record's `data` bag. Radarr and Sonarr are
 * inconsistent about casing across versions (`guid` vs `Guid`), and both
 * spell "no value" two ways - a missing key and an empty string - so both
 * read as absent here rather than leaking `''` into a `GrabbedRelease`.
 */
export function historyValue(
  record: HistoryRecordLike,
  key: string,
): string | undefined {
  const data = record.data
  if (!data) {
    return undefined
  }

  const wanted = key.toLowerCase()

  for (const [dataKey, value] of Object.entries(data)) {
    if (dataKey.toLowerCase() === wanted) {
      return value ? value : undefined
    }
  }

  return undefined
}

/** `data` value parsed as an integer, dropping anything unparseable. */
function historyInteger(
  record: HistoryRecordLike,
  key: string,
): number | undefined {
  const raw = historyValue(record, key)
  if (raw === undefined) {
    return undefined
  }

  const value = Number.parseInt(raw, 10)
  return Number.isNaN(value) ? undefined : value
}

/**
 * `undefined` only when the record carries no protocol at all; an
 * unrecognized value is a real-but-unclassifiable protocol and maps to
 * `unknown`.
 */
function historyProtocol(
  record: HistoryRecordLike,
): ReleaseProtocol | undefined {
  const raw = historyValue(record, 'protocol')
  if (raw === undefined) {
    return undefined
  }

  return PROTOCOLS[Number.parseInt(raw, 10)] ?? 'unknown'
}

/**
 * Sort key for "newest wins". A record with no (or an unparseable) `date`
 * sorts oldest, so a dated record always beats an undated one rather than
 * the comparison silently going false on `NaN`.
 */
function recordTime(record: HistoryRecordLike): number {
  const time = record.date ? Date.parse(record.date) : Number.NaN
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time
}

function toGrabbedRelease(
  record: HistoryRecordLike,
  downloadId: string,
): GrabbedRelease | undefined {
  const guid = historyValue(record, 'guid')
  if (!guid) {
    return undefined
  }

  return {
    downloadId,
    // Top-level on the record, not in `data`: Sonarr scopes each grabbed
    // history entry to an episode, and that's how a season's files stay
    // distinguishable when one grab produced several.
    episodeId: record.episodeId,
    guid,
    // Sonarr's grabbed history carries only the indexer *name*; Radarr's
    // carries both. `indexerId` is therefore surfaced when present and left
    // absent otherwise - resolving a name back to an id needs the indexer
    // list, which this pure join deliberately doesn't have.
    indexer: historyValue(record, 'indexer'),
    indexerId: historyInteger(record, 'indexerId'),
    protocol: historyProtocol(record),
    publishDate: historyValue(record, 'publishedDate'),
    releaseGroup: historyValue(record, 'releaseGroup'),
    size: historyInteger(record, 'size'),
    // `sourceTitle` is the full release name. The guid is a poor label but a
    // unique one, so it stands in rather than rendering an empty row.
    title: record.sourceTitle || guid,
  }
}

/**
 * Joins a title's history back into a `fileId -> release` map.
 *
 * Neither Radarr nor Sonarr stores the indexer guid on the file record, but
 * both remember it in history, and history is walkable in both directions
 * from a `downloadId`:
 *
 * ```
 * fileId -> downloadFolderImported record -> downloadId -> grabbed record -> data.guid
 * ```
 *
 * `data.fileId` on the import record is exactly `movieFile.id` /
 * `episodeFileId`, which is what makes the map keyable by the id callers
 * already hold.
 *
 * Entries are only emitted for a complete round trip. An import with no
 * `data.fileId`, no `downloadId`, or no surviving `grabbed` partner (a manual
 * import, or history pruned past the grab) is simply absent from the map -
 * never present with an empty guid, which would read downstream as a real
 * release that happens to be unidentifiable.
 */
export function mapFilesToReleases(
  records: readonly HistoryRecordLike[],
): Map<number, GrabbedRelease> {
  const grabsByDownloadId = new Map<string, HistoryRecordLike>()
  const importsByFileId = new Map<number, HistoryRecordLike>()

  for (const record of records) {
    if (record.eventType === GRABBED) {
      const downloadId = record.downloadId
      if (!downloadId) {
        continue
      }

      // Newest wins here for the same reason it does for imports below: a
      // failed grab that was retried leaves several records under one
      // downloadId, and the last one is the one that actually landed.
      const existing = grabsByDownloadId.get(downloadId)
      if (!existing || recordTime(record) >= recordTime(existing)) {
        grabsByDownloadId.set(downloadId, record)
      }

      continue
    }

    if (record.eventType !== IMPORTED) {
      continue
    }

    const fileId = historyInteger(record, 'fileId')
    if (fileId === undefined) {
      continue
    }

    // A file can be imported more than once - an upgrade replaces the file
    // in place and reuses its id. The newest import is the one describing
    // what's on disk now.
    const existing = importsByFileId.get(fileId)
    if (!existing || recordTime(record) >= recordTime(existing)) {
      importsByFileId.set(fileId, record)
    }
  }

  const releases = new Map<number, GrabbedRelease>()

  for (const [fileId, record] of importsByFileId) {
    const downloadId = record.downloadId
    if (!downloadId) {
      continue
    }

    const grab = grabsByDownloadId.get(downloadId)
    if (!grab) {
      continue
    }

    const release = toGrabbedRelease(grab, downloadId)
    if (release) {
      releases.set(fileId, release)
    }
  }

  return releases
}
