import type { ShowScope } from '@lilnas/utils/download/types'

import { type HistoryRecordLike, historyValue } from './release-history.util'

/**
 * A file as this decision needs it - an id to be pointed at, the timestamp
 * the import happened, and (for a show) the season it belongs to.
 *
 * Structural rather than an import of Radarr's `MovieFileResource` or
 * Sonarr's `EpisodeFileResource`: those two are field-identical for the
 * three fields that matter here, and both satisfy this shape as-is, so the
 * caller can hand either one straight over without a mapping layer. Every
 * field is optional because both generated resources declare them that way.
 */
export interface CompletionFile {
  id?: number
  dateAdded?: string
  seasonNumber?: number
}

/**
 * The episode -> file link, which the file list itself cannot supply:
 * Sonarr's episode-file resource carries a `seasonNumber` but no episode id,
 * so an episode-scoped question can only be answered episode-first (the same
 * asymmetry `resolveEpisodeFileIds` documents).
 *
 * `id` is optional, symmetrically with `CompletionFile.id`, purely so
 * Sonarr's generated `EpisodeResource` (which declares every field optional)
 * drops straight in at every call site with no `.filter()` or cast. That
 * zero-conversion promise is the whole reason these types are structural,
 * and it has to hold for both callers - the poller and the boot sweep.
 * An episode that arrived without an id can never be the target of an
 * `episodeId` scope. A season scope doesn't need the id - only the season
 * and the file the episode points at.
 */
export interface CompletionEpisode {
  id?: number
  seasonNumber?: number
  episodeFileId?: number
}

/**
 * One `downloadFolderImported` record of the title's history, reduced to
 * what ties a file on disk back to the download that wrote it - see
 * `completionImports`.
 */
export interface CompletionImport {
  /** The download client's id for the download the import came from. */
  downloadId: string
  /** When the import happened, as the wire sent it. */
  date?: string
  /** Sonarr only: the episode the import filled. */
  episodeId?: number
  /**
   * `data.fileId` - the movie or episode file the import wrote. Absent on a
   * record that doesn't name it.
   */
  fileId?: number
}

/** One of the job's own downloads, as `job_downloads` links it. */
export interface CompletionLink {
  downloadId: string
}

export interface CompletionInput {
  /** When the job was created - the "since" of "did a file appear since". */
  createdAt: Date
  /** Absent for a movie, and for a whole-series show job. */
  scope?: ShowScope
  /** Every file Radarr/Sonarr currently has for the job's target. */
  files: readonly CompletionFile[]
  /** Shows only: the episodes the scope is measured against. */
  episodes?: readonly CompletionEpisode[]
  /**
   * The job's own downloads. Absent or empty for a job with none - one from
   * before links were recorded, or a file someone imported by hand - and
   * then a file's date alone decides.
   */
  links?: readonly CompletionLink[]
  /**
   * The title's import history (`completionImports`), read to tie each new
   * file to the download that wrote it. Only consulted when `links` has
   * any: absent there, no file can be credited to the job.
   */
  imports?: readonly CompletionImport[]
  /**
   * The job's queue item this tick, aggregated - present only while the
   * job still has one. See `didJobComplete` for the one case that reads it.
   */
  queueItem?: { episodeHasFile?: boolean }
}

/** The history event type an import is recorded under, matched as a string. */
const IMPORTED = 'downloadFolderImported'

/**
 * The `downloadFolderImported` records of a title's history, as
 * `didJobComplete` reads them. A record with no `downloadId` is dropped -
 * nothing could tie it to a job - and so is every other event type.
 *
 * Only `data.fileId` is read out of `data`: the bag carries the grab's
 * indexer URL, API key included, so none of the rest is kept.
 */
export function completionImports(
  records: readonly HistoryRecordLike[],
): CompletionImport[] {
  const imports: CompletionImport[] = []

  for (const record of records) {
    const downloadId = record.downloadId
    if (record.eventType !== IMPORTED || !downloadId) continue

    const rawFileId = historyValue(record, 'fileId')
    const fileId =
      rawFileId === undefined ? Number.NaN : Number.parseInt(rawFileId, 10)

    imports.push({
      downloadId,
      ...(record.date ? { date: record.date } : {}),
      ...(record.episodeId != null ? { episodeId: record.episodeId } : {}),
      ...(Number.isNaN(fileId) ? {} : { fileId }),
    })
  }

  return imports
}

/**
 * Whether a file's `dateAdded` is newer than the job's creation.
 *
 * `dateAdded` arrives as a `string` off the wire, so it is parsed
 * defensively: absent, empty and unparseable all mean "not new" rather than
 * `NaN` leaking into the comparison. A `NaN` comparison is already `false`,
 * but relying on that would make the intent invisible to the next reader -
 * and an unparseable timestamp must never be the thing that completes a job.
 *
 * A `dateAdded` **exactly equal** to `createdAt` counts as *not* newer: the
 * comparison is strictly `>`. At millisecond resolution an equal timestamp
 * means the file was already in the library at the instant the job was
 * created, and crediting a pre-existing file would complete a job that never
 * downloaded anything - the same false positive an older file represents.
 */
function isAddedAfter(
  file: CompletionFile | undefined,
  createdAtMs: number,
): boolean {
  return isAfter(file?.dateAdded, createdAtMs)
}

/** `isAddedAfter` on a bare timestamp - see there for the parsing rules. */
function isAfter(raw: string | undefined, sinceMs: number): boolean {
  if (typeof raw !== 'string' || raw.trim() === '') return false

  const addedMs = Date.parse(raw)

  return !Number.isNaN(addedMs) && addedMs > sinceMs
}

/**
 * Whether any of `files` was added after `since` - the cheap question that
 * decides whether a title's import history is worth reading at all: with no
 * new file there is nothing to credit to a job.
 */
export function hasFileAddedAfter(
  files: readonly CompletionFile[],
  since: Date,
): boolean {
  const sinceMs = since.getTime()

  return (
    !Number.isNaN(sinceMs) && files.some(file => isAddedAfter(file, sinceMs))
  )
}

/** Files keyed by id, skipping any the upstream returned without one. */
function indexFilesById(
  files: readonly CompletionFile[],
): Map<number, CompletionFile> {
  const byId = new Map<number, CompletionFile>()

  for (const file of files) {
    if (file.id != null) {
      byId.set(file.id, file)
    }
  }

  return byId
}

/**
 * Which files the job's own downloads wrote, or `undefined` for a job with
 * no links - which the caller reads as "credit any new file".
 *
 * An import is the job's when its `downloadId` is one of the links. It
 * credits the file it names (`fileId`); failing that, the file its episode
 * points at now; failing both - a record naming neither, which only Radarr
 * writes, where the title is one file - every file, provided the import
 * itself came after the job.
 */
function ownFiles(
  input: CompletionInput,
  createdAtMs: number,
): { any: boolean; ids: Set<number> } | undefined {
  const { episodes, imports, links } = input

  if (!links || links.length === 0) return undefined

  const linked = new Set(links.map(link => link.downloadId))
  const own = { any: false, ids: new Set<number>() }

  for (const record of imports ?? []) {
    if (!linked.has(record.downloadId)) continue

    if (record.fileId != null) {
      own.ids.add(record.fileId)
    } else if (record.episodeId != null) {
      const fileId = episodes?.find(
        episode => episode.id === record.episodeId,
      )?.episodeFileId

      // `0` is Sonarr's "no file".
      if (fileId) own.ids.add(fileId)
    } else if (isAfter(record.date, createdAtMs)) {
      own.any = true
    }
  }

  return own
}

/**
 * Whether the file `episode` points at landed after `createdAtMs`.
 *
 * An `episodeFileId` of `0` (Sonarr's "no file"), an absent one, and one
 * pointing at a file id that is not in `files` are all `false`, never a
 * throw.
 */
function hasNewFile(
  episode: CompletionEpisode,
  filesById: Map<number, CompletionFile>,
  createdAtMs: number,
): boolean {
  const fileId = episode.episodeFileId

  // `0` is Sonarr's "no file", so truthiness is the right check here.
  if (!fileId) return false

  return isAddedAfter(filesById.get(fileId), createdAtMs)
}

/**
 * Did a file land for this job since it was created?
 *
 * The poller infers a job's progress from Radarr's/Sonarr's queue, sampled
 * every 10s - but an **empty queue is ambiguous**. It means either "nothing
 * has been grabbed yet" or "the grab already finished and was dropped from
 * the queue". A usenet grab of a small file can go `grabbed` -> `imported`
 * in ~6s, i.e. entirely between two ticks, so the queue is empty every time
 * the poller looks and the job wedges at `Searching` forever with its file
 * sitting on disk. (Observed live: two jobs wedged, two grabs out of two.)
 *
 * This resolves the ambiguity without having to catch the download
 * mid-flight, by asking the library instead of the queue: **did a file
 * appear for this job's target since the job was created?**
 *
 * - **Movie**: any file added after `createdAt`.
 * - **Episode scope**: the episode's own file was added after `createdAt`.
 * - **Season scope**: *at least one* episode of that season has one.
 * - **Whole series** - no `scope`, `{}`, or a scope carrying only the
 *   display-only `episodeNumber`, all the same thing: any file of the series
 *   was added after `createdAt`, which is the movie rule on the series' file
 *   list.
 *
 * For a movie, a season and a whole series, a job with `links` credits only
 * a file one of its own downloads imported (`imports`) - otherwise an RSS
 * grab of another episode, or an upgrade of another season, would complete
 * a job that is still stuck. The date alone decides only for a job with no
 * links: one from before links were recorded, or a manual import. An
 * episode scope names its one file, so whatever filled it is the answer.
 *
 * While the job still has a queue item (`queueItem`) only an episode scope
 * can complete, and only when Sonarr says the episode has a file
 * (`episodeHasFile`) and that file is newer than the job: a season pack
 * held up on another episode, or a row Sonarr keeps after a partial manual
 * import, stays in the queue long after this episode landed. A season or a
 * series still has more of its download to come, so it waits for the queue.
 *
 * A season or series needs one new file, not every episode filled, because
 * a job is the record of one attempt, not a measure of the title: episodes
 * already on disk before the job, unaired ones and ones no indexer had never
 * get a new file, and demanding them would fail an attempt that landed
 * everything it could. How much of the title is on disk is media state's
 * job - it is what drives the page's chip and its "N of M episodes". This
 * only asks that the attempt left *some* evidence behind, so a job whose
 * download vanished without a file still reads as not finished.
 *
 * Only this function says what landed; the caller decides what a `false`
 * means (the poller waits on the job's download links - see
 * `settleAbsentJob`).
 *
 * Pure and total: no I/O, no clock reads, and no input - malformed,
 * inconsistent or empty - makes it throw. Everything it cannot positively
 * confirm is `false`, because a false negative just costs another 10s tick
 * while a false positive marks an absent download `Completed`.
 */
export function didJobComplete(input: CompletionInput): boolean {
  const { createdAt, episodes, files, queueItem, scope } = input

  const createdAtMs = createdAt.getTime()

  // An `Invalid Date` would make every comparison false anyway; bailing
  // early says so out loud.
  if (Number.isNaN(createdAtMs)) return false

  if (files.length === 0) return false

  // Still queued: only an episode Sonarr says has a file can be done - the
  // file's date is checked below like any other episode job's.
  if (
    queueItem &&
    (scope?.episodeId == null || queueItem.episodeHasFile !== true)
  ) {
    return false
  }

  const filesById = indexFilesById(files)
  const scopeEpisodes = episodes ?? []

  if (scope?.episodeId != null) {
    // `e.id != null` first, so an id-less episode can never be matched by
    // an `episodeId` scope - `undefined === undefined` is unreachable here
    // (this branch is guarded on `scope.episodeId != null`), but stating it
    // keeps the rule true of the code rather than of its caller.
    const episode = scopeEpisodes.find(
      e => e.id != null && e.id === scope.episodeId,
    )

    // An episode id matching nothing means the episode list is stale or was
    // fetched for the wrong series - no evidence, so no completion.
    return episode ? hasNewFile(episode, filesById, createdAtMs) : false
  }

  const own = ownFiles(input, createdAtMs)
  const isOwn = (fileId: number | undefined) =>
    !own || own.any || (fileId != null && own.ids.has(fileId))

  // A movie is one file and one target, and a whole series is every file
  // the series has, so neither has an episode indirection to walk - any
  // newly added file of the job's own is its file. `== null` rather than
  // falsiness: Sonarr numbers specials as season 0, a season, not the series.
  if (scope?.seasonNumber == null) {
    return files.some(file => isAddedAfter(file, createdAtMs) && isOwn(file.id))
  }

  // Episode-first rather than by the file's own `seasonNumber`, so the
  // episode list stays the one source of truth for what a scope covers - an
  // empty or unresolved list is no evidence, same as for an episode scope.
  return scopeEpisodes.some(
    episode =>
      episode.seasonNumber === scope.seasonNumber &&
      hasNewFile(episode, filesById, createdAtMs) &&
      isOwn(episode.episodeFileId),
  )
}
