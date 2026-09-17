import type { ShowScope } from '@lilnas/utils/download/types'

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
 */
export interface CompletionEpisode {
  id: number
  seasonNumber?: number
  episodeFileId?: number
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
  const raw = file?.dateAdded

  if (typeof raw !== 'string' || raw.trim() === '') return false

  const addedMs = Date.parse(raw)

  return !Number.isNaN(addedMs) && addedMs > createdAtMs
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
 * Every episode in `episodes` has a file that landed after `createdAtMs`.
 *
 * An empty list is `false`, not a vacuous `true`: nothing to satisfy is not
 * success, it means the episode list never resolved and we have no evidence
 * either way. Same for an `episodeFileId` of `0` (Sonarr's "no file") or one
 * pointing at a file id that is not in `files` - unsatisfied, never a throw.
 */
function everyEpisodeHasNewFile(
  episodes: readonly CompletionEpisode[],
  filesById: Map<number, CompletionFile>,
  createdAtMs: number,
): boolean {
  if (episodes.length === 0) return false

  return episodes.every(episode => {
    const fileId = episode.episodeFileId

    // `0` is Sonarr's "no file", so truthiness is the right check here.
    if (!fileId) return false

    return isAddedAfter(filesById.get(fileId), createdAtMs)
  })
}

/**
 * Did this job's download already finish?
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
 * - **Movie** (no `scope`): any file added after `createdAt`.
 * - **Episode scope**: the episode's own file was added after `createdAt`.
 * - **Season scope**: *every* episode of that season has one. A partially
 *   imported season is still downloading, not done.
 * - **Series scope**: every episode of the series has one.
 *
 * Pure and total: no I/O, no clock reads, and no input - malformed,
 * inconsistent or empty - makes it throw. Everything it cannot positively
 * confirm is `false`, because a false negative just costs another 10s tick
 * while a false positive marks an absent download `Completed`.
 */
export function didJobComplete(input: CompletionInput): boolean {
  const { createdAt, episodes, files, scope } = input

  const createdAtMs = createdAt.getTime()

  // An `Invalid Date` would make every comparison false anyway; bailing
  // early says so out loud.
  if (Number.isNaN(createdAtMs)) return false

  if (files.length === 0) return false

  // A movie is one file and one target, so there is no episode indirection
  // to walk - any newly added file is this job's file.
  if (!scope) {
    return files.some(file => isAddedAfter(file, createdAtMs))
  }

  const filesById = indexFilesById(files)
  const scopeEpisodes = episodes ?? []

  if (scope.episodeId != null) {
    const episode = scopeEpisodes.find(e => e.id === scope.episodeId)

    // An episode id matching nothing means the episode list is stale or was
    // fetched for the wrong series - no evidence, so no completion.
    return episode
      ? everyEpisodeHasNewFile([episode], filesById, createdAtMs)
      : false
  }

  if (scope.seasonNumber != null) {
    // `!= null` rather than truthiness: Sonarr numbers specials as season 0,
    // and a truthy check would silently widen that to the whole series.
    const seasonEpisodes = scopeEpisodes.filter(
      episode => episode.seasonNumber === scope.seasonNumber,
    )

    return everyEpisodeHasNewFile(seasonEpisodes, filesById, createdAtMs)
  }

  return everyEpisodeHasNewFile(scopeEpisodes, filesById, createdAtMs)
}
