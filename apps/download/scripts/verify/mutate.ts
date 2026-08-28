/**
 * The **write-path** half of the backend verification runner: one movie, one
 * episode of one series, one five-second video — created against the real
 * Radarr/Sonarr/MinIO, watched until they move, and then torn down.
 *
 * ```
 * tsx scripts/verify/verify-backend.ts preflight --repo-path /path/to/lilnas
 * tsx scripts/verify/verify-backend.ts mutate    --repo-path /path/to/lilnas
 * tsx scripts/verify/verify-backend.ts mutate --cleanup-only --repo-path ...
 * ```
 *
 * `capture`/`check` only ever read. Everything here creates something in a
 * production library, so the guardrails — not the polling — are the substance
 * of this file. Five of them, in the order they matter:
 *
 * 1. **Journal before create.** {@link MutationJournal.claim} writes the
 *    *intent* to `captures/mutate-journal.json` and fsyncs it **before** the
 *    POST is issued, not after it returns. The job id does not exist until the
 *    backend answers, so the claim records the fixture identity instead, and
 *    {@link MutationJournal.attach} amends it with the job id afterwards. A
 *    crash in that window therefore leaves an entry that
 *    {@link resolveOrphanClaim} can still turn back into a job id, which is
 *    what makes `--cleanup-only` a real drain rather than a report.
 * 2. **Cleanup in a `finally`.** Every pass tears down in a `finally`, so a
 *    throw anywhere in the middle still runs it.
 * 3. **The destructive request is allowlisted, structurally.**
 *    {@link MutationJournal.destroy} is the only function in this file that
 *    issues a `DELETE`/`PATCH`, and its parameter is a {@link CleanupTicket},
 *    not an id. `CleanupTicket` carries a module-private `unique symbol` that
 *    nothing outside this file can name, so only the journal can mint one; and
 *    `destroy` re-reads the journal off disk and re-checks the ticket against
 *    it before sending anything. A forged id cannot be typed, and a stale one
 *    cannot survive the re-read.
 * 4. **`preflight` refuses a fixture already in the library.** Not politeness:
 *    if the movie is already there, teardown would delete somebody's real
 *    copy. `radarrId`/`sonarrId` are present iff the title is in the library
 *    (`toMovie()`/`toShow()` use `|| undefined` because a non-library lookup
 *    hit comes back as `id: 0`), so their absence is the test. `preflight`
 *    itself sends nothing but `GET`s.
 * 5. **Season-count guard.** A `tvdbId` reporting more than one non-special
 *    season is refused outright.
 *
 * ---
 *
 * ### The show pass is always scoped — **narrowest scope available wins**
 *
 * `RequestShowInputSchema` (`packages/utils/src/download/schema.ts:111`) is
 * `{ episodeId?, seasonNumber?, tvdbId }`, and `POST /download/shows`
 * (`download.controller.ts:1111`) passes that scope through. A scoped request
 * calls `ensureSeries(tvdbId, {monitorEpisodes: scope})` and then
 * `triggerScopedSearch`, which picks the narrowest of
 * `EpisodeSearch`/`SeasonSearch`/`SeriesSearch`
 * (`media-download.service.ts:136-209`). A fresh add fires **no** search:
 * `addOptions.searchForMissingEpisodes` and `searchForCutoffUnmetEpisodes` are
 * both `false` (`sonarr.service.ts:388-394`).
 *
 * Two scopes are usable, and {@link preflightShow} picks the narrower one that
 * is actually obtainable:
 *
 * 1. **`{tvdbId, episodeId}` — one `EpisodeSearch`.** Preferred whenever an
 *    `episodeId` can be had, which means `GET /download/media/:id/seasons`
 *    answered. `ShowService.listSeasons()` deliberately 404s a series that is
 *    not already in the library ("adding a series to the library as a side
 *    effect of a GET would be a genuine surprise"), so in practice this branch
 *    needs the series to be there already.
 * 2. **`{tvdbId, seasonNumber}` — one `SeasonSearch`.** The fallback, and the
 *    branch that actually runs against a clean library. It is **self-contained
 *    and needs no prior lookup**: `SonarrService.resolveScope()`
 *    (`sonarr.service.ts:753`) returns a season-only scope unchanged as its
 *    very first statement — the `getApiV3EpisodeById` round trip only happens
 *    for an `episodeId` — and `triggerScopedSearch` fires
 *    `triggerSeasonSearch(sonarrId, seasonNumber)` on the
 *    `scope?.seasonNumber != null` branch. So a season-scoped request works on
 *    a series Sonarr has never seen.
 *
 * A bare `{tvdbId}` is **never** sent: that is the whole-series request this
 * pass exists to avoid.
 *
 * ⚠️ **The add still uses `addOptions.monitor: 'all'`** whichever scope is
 * used, so every episode of every season ends up monitored even though only
 * one episode or one season is searched, and Sonarr's RSS sync can grab the
 * others on its own schedule afterwards. That is why teardown deletes the
 * **series** (`DELETE /download/shows/:jobId` →
 * `sonarrService.unmonitorAndDelete()`, which cancels the queue items and then
 * `DELETE /api/v3/series/{id}?deleteFiles=true`) rather than unmonitoring it,
 * and why it must run promptly. It is also why the `seasonCount > 1` guard
 * stays: a single-season fixture keeps that monitored-but-unsearched window as
 * small as it can be.
 *
 * ⚠️ **The season-count guard is unverifiable on the fallback branch.** It
 * reads `GET /download/media/:id/seasons`, which is exactly the call that 404s
 * for a series not in the library — so on the clean-library path there are no
 * upstream statistics to check and the guard reports `SKIPPED`, not `PASS`.
 * `fixtures.json`'s `expectedEpisodes` is the human-vetted stand-in for that
 * ceiling, and the report says so every time.
 *
 * ### The video pass cleans up like the other two
 *
 * Teardown is `DELETE /download/videos/:jobId`
 * (`DownloadService.deleteVideoDownloadJob()`), which stops a running job,
 * removes its MinIO objects and clears the `videos` row's `downloadUrls`.
 *
 * This route did not always exist. `PATCH /download/videos/:id/cancel` was
 * the only teardown a video had, and it throws `Job '<id>' has not started`
 * (→ 404) once the job is `Completed`; `DELETE /download/media/:id/files`
 * 404s any `video:` key (`parseReleaseTarget()`). A video that finished was
 * therefore unremovable through the API, and the journal recorded it as
 * **residue** — a separate list reported loudly on every subsequent run until
 * a human cleared it. That residue machinery is kept: an old journal may
 * still carry entries, and a teardown can still come back `gone` for reasons
 * other than "no route exists".
 *
 * ### What is deliberately out of scope
 *
 * ⚠️ `POST /download/media/:id/releases/grab` (`download.controller.ts:648`)
 * hands a chosen release to the download client, which pulls **real bytes from
 * a real indexer**. It exists, it is untested by this script, and it needs its
 * own deliberate session with someone watching the download client. Nothing
 * here calls it, and nothing here should be extended to.
 *
 * ### `expectedEpisodes` is advisory
 *
 * `fixtures.json`'s `show.expectedEpisodes` is a **human-vetted note**, not an
 * enforceable pre-condition: Sonarr's `/api/v3/series/lookup` reports
 * `statistics.episodeCount: 0` for a series that is not in the library, so
 * there is no count to check until after the add — by which point checking it
 * is too late to be a guard. Every report this file prints says so.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { z } from 'zod'

import {
  DownloadJobStatus,
  TimeRangeSchema,
} from '../../../../packages/utils/src/download/schema'
import {
  ActivityPageSchema,
  DownloadJobResponseSchema,
  ListSeasonsResponseSchema,
  MediaDetailResponseSchema,
} from './envelopes'
import {
  exitCodeFor,
  formatZodIssues,
  renderReport,
  type ReportHeader,
  type ReportRow,
  type ReportSection,
} from './report'
import {
  dockerExecTransport,
  type HttpMethod,
  httpTransport,
  isTransportError,
  type Transport,
} from './transport'
import type { FlagSpec, Mode, ParsedArgs } from './verify-backend'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CAPTURES_DIR = path.join(__dirname, 'captures')
const DEFAULT_FIXTURES_FILE = path.join(__dirname, 'fixtures.json')

/** Lives in `captures/`, which `.gitignore` already covers. */
const JOURNAL_FILE = 'mutate-journal.json'

/**
 * Synthetic, and deliberately recognisable in an audit row. Unlike the read
 * sweep's, this one *does* land in the database — every pass below writes an
 * audit entry — which is exactly why it must be identifiable.
 */
const MUTATE_USER_ID = 'verify-backend-mutate'

/**
 * `MediaPollerService` runs on a 10s `@Cron`, so polling faster than that
 * only produces duplicate observations. Five seconds is half a tick: enough
 * to catch a transition promptly, not enough to hammer.
 */
const MEDIA_POLL_INTERVAL_MS = 5_000

/**
 * A movie/show job can legitimately sit in `Searching` forever — a grab needs
 * an indexer to actually hold the release. The window bounds how long this
 * script is willing to watch, never what it asserts.
 */
const MEDIA_POLL_WINDOW_MS = 90_000

/** The video pipeline has no cron behind it; stages change in seconds. */
const VIDEO_POLL_INTERVAL_MS = 2_000

/** yt-dlp + ffmpeg + a MinIO upload for a five-second clip. */
const VIDEO_POLL_WINDOW_MS = 180_000

/** How far back `/download/activity` is scanned when recovering an orphan. */
const ORPHAN_SCAN_LIMIT = 100

/**
 * Slack on the claim timestamp when matching an orphan. Covers clock skew
 * between this process and the container, which is otherwise enough to make a
 * job created *because of* a claim look like it predates it.
 */
const ORPHAN_CLOCK_SKEW_MS = 120_000

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * `fixtures.json` is **committed** — public catalogue ids, an admin address
 * that is already in this repo's docs, and a YouTube URL. Nothing secret.
 *
 * The video fixture is `jNQXAC9IVRw` ("Me at the zoo"): nineteen seconds,
 * 240p, online since April 2005, and about as stable and uncontroversial as a
 * YouTube URL gets. The five-second range is passed to yt-dlp as
 * `--download-sections` (`download-video.service.ts:271-278`), so the fetch is
 * a few hundred kilobytes rather than the whole clip.
 */
const FixturesSchema = z.strictObject({
  adminEmail: z.string().min(3),
  movie: z.strictObject({
    tmdbId: z.number().int().positive(),
    title: z.string().min(1),
    year: z.number().int().positive(),
  }),
  show: z.strictObject({
    tvdbId: z.number().int().positive(),
    title: z.string().min(1),
    /**
     * The season the fallback request scopes to.
     *
     * `.min(0)`, matching `RequestShowInputSchema.seasonNumber` — **season 0
     * is Sonarr's specials season**, a real value and not a sentinel
     * (`media-download.service.ts:200`). Every presence check in this file is
     * therefore `!= null`, never truthiness.
     */
    seasonNumber: z.number().int().min(0),
    /** Advisory only — see this module's docblock. */
    expectedEpisodes: z.number().int().positive(),
  }),
  video: z.strictObject({
    url: z.string().url(),
    timeRange: TimeRangeSchema,
  }),
})

export type Fixtures = z.infer<typeof FixturesSchema>

async function loadFixtures(file: string): Promise<Fixtures> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    throw new MutateUsageError(
      `Could not read fixtures at ${file}: ${describe(error)}`,
    )
  }

  const parsed = FixturesSchema.safeParse(safeJsonParse(text))
  if (!parsed.success) {
    throw new MutateUsageError(
      `${file} is not a valid fixtures file:\n  ` +
        formatZodIssues(parsed.error, 6).join('\n  '),
    )
  }
  return parsed.data
}

// ---------------------------------------------------------------------------
// The job state machine
// ---------------------------------------------------------------------------

/**
 * Terminal states, verbatim from `TERMINAL_DOWNLOAD_JOB_STATUSES`
 * (`packages/utils/src/download/types.ts:56-60`). `Paused`/`Pausing` are
 * **not** terminal — both exist today and are deliberately excluded there, so
 * anything that treats "not moving" as "finished" would be wrong about a
 * paused job.
 */
const TERMINAL_STATUSES: ReadonlySet<DownloadJobStatus> = new Set([
  DownloadJobStatus.Cancelled,
  DownloadJobStatus.Completed,
  DownloadJobStatus.Failed,
])

/**
 * Every non-terminal state can be interrupted or swept, so these are legal
 * successors of *anything* that has not already finished:
 *
 * - `Failed` — `reconcileInterruptedJobs()` sweeps every non-terminal row to
 *   `failed` at boot (`schema.ts:18-28`), and the poller writes it on a queue
 *   error.
 * - `Cancelled`/`Cancelling` — teardown, which this script issues itself.
 */
const ALWAYS_REACHABLE: readonly DownloadJobStatus[] = [
  DownloadJobStatus.Cancelled,
  DownloadJobStatus.Cancelling,
  DownloadJobStatus.Failed,
]

/**
 * States a job sits in until something external moves it, as opposed to the
 * transient ones it moves through under its own steam.
 *
 * `isReachable()` will not walk *through* these. `Paused` is here for the
 * same reason the terminal statuses are: a paused job stays paused until a
 * user resumes it, so a poller cannot miss one the way it misses a
 * sub-second `Uploading`.
 */
const RESTING_STATUSES: ReadonlySet<DownloadJobStatus> = new Set([
  ...TERMINAL_STATUSES,
  DownloadJobStatus.Paused,
])

/**
 * Movie/show transitions, read off `MediaDownloadService.request()`
 * (`Requested` → `Searching`|`Failed`), `MediaPollerService.applyUpdate()` and
 * `deriveStatusFromQueueItem()` (`queue-status.util.ts`).
 *
 * The one that is easy to get wrong: **`Searching` cannot reach `Completed`
 * directly.** `deriveStatusFromQueueItem` only returns `Completed` for a job
 * already in `Downloading` or `Importing` whose queue item has vanished; with
 * no item and any other current status it returns the status unchanged. So a
 * job that never entered the queue stays in `Searching` indefinitely — which
 * is a legitimate outcome (no indexer had the release), not a stall to fail on.
 */
const MEDIA_TRANSITIONS: ReadonlyMap<
  DownloadJobStatus,
  readonly DownloadJobStatus[]
> = new Map([
  [DownloadJobStatus.Requested, [DownloadJobStatus.Searching]],
  [
    DownloadJobStatus.Searching,
    [DownloadJobStatus.Downloading, DownloadJobStatus.Importing],
  ],
  [
    DownloadJobStatus.Downloading,
    [DownloadJobStatus.Importing, DownloadJobStatus.Completed],
  ],
  [
    DownloadJobStatus.Importing,
    [DownloadJobStatus.Downloading, DownloadJobStatus.Completed],
  ],
])

/**
 * Video transitions, read off `DownloadService` (`Pending`, `Pausing`,
 * `Cancelling`), `DownloadVideoService` (`Downloading` → `Converting` →
 * `Uploading` → `Cleaning`, one per pipeline step) and
 * `DownloadSchedulerService` (`Completed`, and the interrupt branch resolving
 * `pause` → `Paused` / `cancel` → `Cancelled`).
 */
const VIDEO_TRANSITIONS: ReadonlyMap<
  DownloadJobStatus,
  readonly DownloadJobStatus[]
> = new Map([
  [
    DownloadJobStatus.Pending,
    [DownloadJobStatus.Downloading, DownloadJobStatus.Pausing],
  ],
  [
    DownloadJobStatus.Downloading,
    [DownloadJobStatus.Converting, DownloadJobStatus.Pausing],
  ],
  [
    DownloadJobStatus.Converting,
    [DownloadJobStatus.Uploading, DownloadJobStatus.Pausing],
  ],
  [
    DownloadJobStatus.Uploading,
    [DownloadJobStatus.Cleaning, DownloadJobStatus.Pausing],
  ],
  [
    DownloadJobStatus.Cleaning,
    [DownloadJobStatus.Completed, DownloadJobStatus.Pausing],
  ],
  [DownloadJobStatus.Pausing, [DownloadJobStatus.Paused]],
  [DownloadJobStatus.Paused, [DownloadJobStatus.Pending]],
  [DownloadJobStatus.Cancelling, []],
])

function legalSuccessors(
  kind: MutationKind,
  from: DownloadJobStatus,
): readonly DownloadJobStatus[] {
  if (TERMINAL_STATUSES.has(from)) {
    // The poller filters terminal jobs out of `trackedJobs`, and
    // `updateJob()` is never called on one again during a watch. Absorbing,
    // by construction. (The delete routes *do* write Cancelled onto a
    // Completed job, but a watch has already stopped by then.)
    return []
  }
  const table = kind === 'video' ? VIDEO_TRANSITIONS : MEDIA_TRANSITIONS
  return [...(table.get(from) ?? []), ...ALWAYS_REACHABLE]
}

/**
 * Whether `to` is reachable from `from` along the transition graph.
 *
 * **Reachability, not adjacency, is the honest predicate here**, and the
 * distinction is not pedantic: this checker reads a *sampled* status, so it
 * only ever sees the states a poll happened to land on. `Uploading` and
 * `Cleaning` are a 139 KB `fPutObject` and an `rm` of a scratch directory —
 * for a five-second clip both routinely complete inside one poll interval,
 * so the poller reads `converting`, then `completed`, and an adjacency test
 * calls that an illegal transition. It isn't: the backend went
 * `converting → uploading → cleaning → completed` and the watcher blinked.
 *
 * Reporting that as a state-machine violation is worse than reporting
 * nothing, because it puts a red row next to a backend that behaved
 * perfectly and trains the reader to discount red rows.
 *
 * This keeps all the value of the check. A genuinely impossible observation
 * — `completed → downloading`, `paused → uploading`, anything that would
 * mean a status was written out of band — is still unreachable in the graph
 * and still fails. All that is given up is the ability to insist every
 * intermediate state was *witnessed*, which polling was never able to
 * promise.
 */
export function isReachable(
  kind: MutationKind,
  from: DownloadJobStatus,
  to: DownloadJobStatus,
): boolean {
  const seen = new Set<DownloadJobStatus>([from])
  const queue: DownloadJobStatus[] = [from]

  while (queue.length > 0) {
    const at = queue.shift() as DownloadJobStatus

    for (const next of legalSuccessors(kind, at)) {
      if (next === to) {
        return true
      }

      // Traverse *transient* states only. A job passes through `Pausing` or
      // `Converting` on its own and can be gone before the next poll, so
      // walking through them models a blink. It does not leave `Paused` or
      // any terminal status without a fresh user action, so walking through
      // one would launder a genuinely backwards observation into a legal
      // path: `cleaning → downloading` is impossible, but
      // `cleaning → pausing → paused → pending → downloading` is a route
      // through the graph. Refusing to expand the resting states is what
      // keeps that impossible - and keeps this check worth running.
      if (RESTING_STATUSES.has(next)) {
        continue
      }

      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// The journal
// ---------------------------------------------------------------------------

export type MutationKind = 'movie' | 'show' | 'video'

const MUTATION_KINDS: readonly MutationKind[] = ['movie', 'show', 'video']

function isMutationKind(value: string): value is MutationKind {
  return (MUTATION_KINDS as readonly string[]).includes(value)
}

/**
 * How a mutation is undone. A closed table keyed by kind, so
 * {@link MutationJournal.destroy} never assembles a path from anything a
 * caller supplied except the journal-verified job id.
 *
 * All three are `DELETE`. `video` used to be the odd one out — a `PATCH` to
 * `/cancel`, because no delete route existed for a video — and that is what
 * made a completed video permanently un-tearable. See the module docblock.
 */
const TEARDOWN: Readonly<
  Record<MutationKind, { method: HttpMethod; path: (jobId: string) => string }>
> = {
  movie: {
    method: 'DELETE',
    path: jobId => `/download/movies/${encodeURIComponent(jobId)}`,
  },
  show: {
    method: 'DELETE',
    path: jobId => `/download/shows/${encodeURIComponent(jobId)}`,
  },
  video: {
    method: 'DELETE',
    path: jobId => `/download/videos/${encodeURIComponent(jobId)}`,
  },
}

const JournalEntrySchema = z.object({
  entryId: z.string().min(1),
  kind: z.enum(['movie', 'show', 'video']),
  /**
   * `claimed` = written before the POST; the job id is not known yet.
   * `created` = the POST answered and `jobId` is real.
   */
  state: z.enum(['claimed', 'created']),
  label: z.string(),
  claimedAt: z.string(),
  /** `tmdb:`/`tvdb:` key. Absent for a video, whose key is minted server-side. */
  mediaId: z.string().optional(),
  /** The video fixture URL, which is how an orphaned video claim is matched. */
  sourceUrl: z.string().optional(),
  jobId: z.string().optional(),
})

const ResidueEntrySchema = z.object({
  entryId: z.string().min(1),
  kind: z.enum(['movie', 'show', 'video']),
  label: z.string(),
  jobId: z.string().optional(),
  mediaId: z.string().optional(),
  reason: z.string(),
  recordedAt: z.string(),
})

/**
 * Deliberately not `.strict()`: a journal written by a newer revision of this
 * script must still be *drainable* by an older one. Losing the entry it was
 * written for is the one failure mode a journal cannot have.
 */
const JournalFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(JournalEntrySchema),
  residue: z.array(ResidueEntrySchema),
})

type JournalEntry = z.infer<typeof JournalEntrySchema>
type ResidueEntry = z.infer<typeof ResidueEntrySchema>
type JournalFile = z.infer<typeof JournalFileSchema>

const EMPTY_JOURNAL: JournalFile = { version: 1, entries: [], residue: [] }

/**
 * The brand that makes {@link CleanupTicket} unforgeable.
 *
 * Module-private and never exported, so no code outside this file can name the
 * key — and an object literal that does not have it is not a `CleanupTicket`
 * as far as the type checker is concerned. That is the structural half of the
 * DELETE allowlist; {@link MutationJournal.destroy}'s re-read is the runtime
 * half.
 */
const MINTED_BY_JOURNAL: unique symbol = Symbol('minted-by-journal')

/**
 * Permission to tear down exactly one thing this script created. Obtainable
 * only from {@link MutationJournal.attach} or
 * {@link MutationJournal.ticketFor}, both of which mint one only for an entry
 * that is already durable on disk.
 */
export interface CleanupTicket {
  readonly [MINTED_BY_JOURNAL]: true
  readonly entryId: string
  readonly kind: MutationKind
  readonly jobId: string
  readonly label: string
}

/** A journalled intent whose POST has not been issued (or has not answered). */
export interface MutationClaim {
  readonly entryId: string
  readonly kind: MutationKind
  readonly label: string
  readonly claimedAt: string
}

export type TeardownOutcome =
  | { kind: 'deleted'; status: number }
  | { kind: 'gone'; status: number; detail: string }
  | { kind: 'failed'; status: number | null; detail: string }

/**
 * The crash-safe record of everything this run created.
 *
 * Every write goes through {@link writeDurable}: a temp file in the same
 * directory, `fsync`ed, then `rename`d over the target, then the directory
 * `fsync`ed too. `rename` within a directory is atomic on POSIX, so a reader
 * — including the next run of this script — sees either the whole old journal
 * or the whole new one, never a half-written one. The `fsync` before the
 * rename is what makes that survive a power cut rather than only a crash.
 */
export class MutationJournal {
  private constructor(
    readonly file: string,
    private data: JournalFile,
  ) {}

  static async open(file: string): Promise<MutationJournal> {
    await mkdir(path.dirname(file), { recursive: true })
    return new MutationJournal(file, await readJournal(file))
  }

  get entries(): readonly JournalEntry[] {
    return this.data.entries
  }

  get residue(): readonly ResidueEntry[] {
    return this.data.residue
  }

  /**
   * Records the *intent* and returns only once it is durable. The caller must
   * not issue its POST until this has resolved — that ordering is the whole
   * point, and it is why this returns a `MutationClaim` rather than taking a
   * callback: the sequencing is visible at the call site.
   */
  async claim(input: {
    kind: MutationKind
    label: string
    mediaId?: string
    sourceUrl?: string
  }): Promise<MutationClaim> {
    const entry: JournalEntry = {
      entryId: randomUUID(),
      kind: input.kind,
      state: 'claimed',
      label: input.label,
      claimedAt: new Date().toISOString(),
      ...(input.mediaId ? { mediaId: input.mediaId } : {}),
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    }

    this.data = { ...this.data, entries: [...this.data.entries, entry] }
    await this.flush()

    return {
      entryId: entry.entryId,
      kind: entry.kind,
      label: entry.label,
      claimedAt: entry.claimedAt,
    }
  }

  /** Amends a claim with the id the backend minted, and hands back a ticket. */
  async attach(
    claim: MutationClaim,
    jobId: string,
    mediaId?: string,
  ): Promise<CleanupTicket> {
    const updated = this.data.entries.map(entry =>
      entry.entryId === claim.entryId
        ? {
            ...entry,
            state: 'created' as const,
            jobId,
            ...(mediaId ? { mediaId } : {}),
          }
        : entry,
    )
    this.data = { ...this.data, entries: updated }
    await this.flush()

    return this.ticketFor(claim.entryId) ?? unreachable('attach lost its entry')
  }

  /**
   * A ticket for an entry that is already `created`, or `undefined`. The only
   * other minting site, used by `--cleanup-only` to drain a journal this
   * process did not write.
   */
  ticketFor(entryId: string): CleanupTicket | undefined {
    const entry = this.data.entries.find(
      candidate => candidate.entryId === entryId,
    )
    if (!entry || entry.state !== 'created' || !entry.jobId) {
      return undefined
    }
    return {
      [MINTED_BY_JOURNAL]: true,
      entryId: entry.entryId,
      kind: entry.kind,
      jobId: entry.jobId,
      label: entry.label,
    }
  }

  /**
   * **The one function in this file that issues a destructive request.**
   *
   * Three things have to line up before a byte leaves:
   *
   * 1. The argument is a {@link CleanupTicket}, which only this class can
   *    mint — a raw id is not accepted and cannot be constructed.
   * 2. The journal is re-read **from disk** and the ticket re-checked against
   *    it. A ticket that outlived its entry (another process drained it, or a
   *    cast smuggled one in) is refused here, not at the call site.
   * 3. The request path comes from {@link TEARDOWN}, a closed table keyed by
   *    the entry's own `kind`. Nothing string-shaped from a caller reaches it.
   */
  async destroy(
    request: RequestFn,
    ticket: CleanupTicket,
  ): Promise<TeardownOutcome> {
    await this.reload()

    const entry = this.data.entries.find(
      candidate => candidate.entryId === ticket.entryId,
    )
    if (!entry || entry.state !== 'created' || entry.jobId !== ticket.jobId) {
      return {
        kind: 'failed',
        status: null,
        detail:
          `Refused to tear down job ${ticket.jobId}: it is no longer in ` +
          `${this.file} as a created entry. Nothing was sent. This is the ` +
          'allowlist doing its job — the script deletes only what its own ' +
          'journal says it created.',
      }
    }

    const teardown = TEARDOWN[entry.kind]
    const attempt = await request({
      method: teardown.method,
      path: teardown.path(entry.jobId),
      schema: DownloadJobResponseSchema,
    })

    if (attempt.ok) {
      await this.drop(ticket.entryId)
      return { kind: 'deleted', status: attempt.status }
    }

    // A 404 means the backend has nothing left to act on. The entry is
    // deliberately **left in place**: whether that counts as done (a movie or
    // show that is already gone) or as an artefact nothing can remove (a video
    // that finished before it could be cancelled) is the caller's call, and it
    // is the difference between `drop` and `retire`.
    if (attempt.status === 404) {
      return {
        kind: 'gone',
        status: 404,
        detail: attempt.reason,
      }
    }

    return {
      kind: 'failed',
      status: attempt.status,
      detail: attempt.reason,
    }
  }

  /** Removes an entry outright. Used after a successful teardown. */
  async drop(entryId: string): Promise<void> {
    this.data = {
      ...this.data,
      entries: this.data.entries.filter(entry => entry.entryId !== entryId),
    }
    await this.flush()
  }

  /**
   * Moves an entry out of `entries` and into `residue`: something was created
   * that this script has no way to remove. It is reported on every subsequent
   * run and never retried — a pending entry that can never succeed would make
   * `--cleanup-only` a permanent failure and train the reader to ignore it.
   */
  async retire(entryId: string, reason: string): Promise<void> {
    const entry = this.data.entries.find(
      candidate => candidate.entryId === entryId,
    )
    if (!entry) {
      return
    }
    this.data = {
      version: 1,
      entries: this.data.entries.filter(
        candidate => candidate.entryId !== entryId,
      ),
      residue: [
        ...this.data.residue,
        {
          entryId: entry.entryId,
          kind: entry.kind,
          label: entry.label,
          ...(entry.jobId ? { jobId: entry.jobId } : {}),
          ...(entry.mediaId ? { mediaId: entry.mediaId } : {}),
          reason,
          recordedAt: new Date().toISOString(),
        },
      ],
    }
    await this.flush()
  }

  private async reload(): Promise<void> {
    this.data = await readJournal(this.file)
  }

  private async flush(): Promise<void> {
    await writeDurable(this.file, `${JSON.stringify(this.data, null, 2)}\n`)
  }
}

async function readJournal(file: string): Promise<JournalFile> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (isEnoent(error)) {
      return EMPTY_JOURNAL
    }
    throw error
  }

  const parsed = JournalFileSchema.safeParse(safeJsonParse(text))
  if (!parsed.success) {
    // Never silently reset: an unreadable journal may still be the only
    // record that something was created, and overwriting it destroys that.
    throw new Error(
      `${file} exists but is not a journal:\n  ` +
        `${formatZodIssues(parsed.error, 4).join('\n  ')}\n` +
        'Refusing to overwrite it. Inspect it by hand, then delete it.',
    )
  }
  return parsed.data
}

/**
 * Atomic, fsynced replacement. See {@link MutationJournal} for why both halves
 * matter.
 */
async function writeDurable(file: string, text: string): Promise<void> {
  const dir = path.dirname(file)
  const tmp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`)

  const handle = await open(tmp, 'w')
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await rename(tmp, file)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }

  // Makes the rename itself durable. Not portable — a directory cannot be
  // opened for reading on Windows — and the rename is still atomic without
  // it, so a failure here is not worth failing the run over.
  try {
    const dirHandle = await open(dir, 'r')
    try {
      await dirHandle.sync()
    } finally {
      await dirHandle.close()
    }
  } catch {
    /* best effort */
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type Attempt<T> =
  | {
      ok: true
      status: number
      data: T
      headers: Record<string, string>
      durationMs: number
    }
  | { ok: false; status: number | null; reason: string; body: string | null }

interface RequestInput<T> {
  method?: HttpMethod
  path: string
  json?: unknown
  /**
   * The contract the response must satisfy. Omitted for a route that does not
   * answer with JSON — which on this surface is only
   * `GET /download/media/:id/file`, and which must also set
   * {@link RequestInput.bodyMode}.
   */
  schema?: z.ZodType<T>
  /**
   * `'headers-only'` discards the body without buffering it. Not an
   * optimisation: the MinIO branch of `/media/:id/file` deliberately ignores
   * `Range` (`download.controller.ts:543-545`), so there is no way to ask for
   * less than the whole object, and reading it into this process would be the
   * only alternative.
   */
  bodyMode?: 'json' | 'headers-only'
}

type RequestFn = <T>(input: RequestInput<T>) => Promise<Attempt<T>>

/**
 * One request, parsed against the schema the caller expects.
 *
 * Everything that can go wrong collapses into `ok: false` with a sentence a
 * report row can print: unreachable, non-2xx, unparseable, schema mismatch.
 * The distinction that survives is `status`, because a 404 on teardown means
 * something very different from a 500.
 */
function makeRequest(
  transport: Transport,
  headers: Record<string, string>,
): RequestFn {
  // A generic function *declaration* rather than an arrow typed as
  // `RequestFn`: the `data: undefined as T` below needs `T` nameable inside
  // the body, and a type annotation alone does not bring it into scope.
  return async function request<T>(
    input: RequestInput<T>,
  ): Promise<Attempt<T>> {
    const method = input.method ?? 'GET'
    let status: number | null = null
    let body: string | null = null

    try {
      const response = await transport(input.path, headers, {
        method,
        json: input.json,
        bodyMode: input.bodyMode,
      })
      status = response.status
      body = response.body

      if (status < 200 || status >= 300) {
        return {
          ok: false,
          status,
          body,
          reason: `${method} ${input.path} answered HTTP ${status}${errorDetail(body)}`,
        }
      }

      // No schema means there is nothing to parse — the route answered with
      // bytes, and the status and headers are the whole result.
      if (!input.schema) {
        return {
          ok: true,
          status,
          data: undefined as T,
          headers: response.headers,
          durationMs: response.durationMs,
        }
      }

      const json = safeJsonParse(body)
      if (json === undefined) {
        return {
          ok: false,
          status,
          body,
          reason: `${method} ${input.path} answered HTTP ${status} with a non-JSON body`,
        }
      }

      const parsed = input.schema.safeParse(json)
      if (!parsed.success) {
        return {
          ok: false,
          status,
          body,
          reason:
            `${method} ${input.path} answered a shape the contract does not ` +
            `allow: ${formatZodIssues(parsed.error, 4).join('; ')}`,
        }
      }

      return {
        ok: true,
        status,
        data: parsed.data,
        headers: response.headers,
        durationMs: response.durationMs,
      }
    } catch (error) {
      if (isTransportError(error)) {
        return {
          ok: false,
          status: null,
          body: null,
          reason: `${method} ${input.path} could not be delivered (${error.reason}): ${error.message}`,
        }
      }
      throw error
    }
  }
}

/** The `message` a Nest exception filter puts in the body, when there is one. */
function errorDetail(body: string | null): string {
  if (!body) {
    return ''
  }
  const record = asRecord(safeJsonParse(body))
  const message = record?.message ?? record?.error
  const text =
    typeof message === 'string'
      ? message
      : Array.isArray(message)
        ? message.join('; ')
        : body
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed === ''
    ? ''
    : ` — ${collapsed.length > 180 ? `${collapsed.slice(0, 180)}…` : collapsed}`
}

// ---------------------------------------------------------------------------
// Shared run context
// ---------------------------------------------------------------------------

interface MutateContext {
  request: RequestFn
  journal: MutationJournal
  fixtures: Fixtures
  capturesDir: string
  only: MutationKind | undefined
  keep: boolean
}

function movieKey(fixtures: Fixtures): string {
  return `tmdb:${fixtures.movie.tmdbId}`
}

function showKey(fixtures: Fixtures): string {
  return `tvdb:${fixtures.show.tvdbId}`
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

/**
 * The scope the show pass will request, decided in preflight so the pass does
 * not repeat the lookup.
 *
 * Narrowest first. `episode` is one `EpisodeSearch`; `season` is one
 * `SeasonSearch` and needs no prior lookup at all. There is deliberately no
 * variant for a bare `{tvdbId}` — a whole-series request is not representable
 * here, so no branch of the pass can accidentally produce one.
 */
export type ShowScopePlan =
  | {
      kind: 'episode'
      episodeId: number
      seasonNumber: number
      label: string
    }
  | { kind: 'season'; seasonNumber: number; label: string }
  | { kind: 'skip'; reason: string }

/** What a pass needs to know before it is allowed to write anything. */
export interface PreflightResult {
  rows: ReportRow[]
  /** A refusal is fatal for `mutate`; `preflight` just reports them. */
  refusals: string[]
  showScope: ShowScopePlan
}

async function preflight(ctx: MutateContext): Promise<PreflightResult> {
  const rows: ReportRow[] = []
  const refusals: string[] = []

  const refuse = (name: string, note: string, details: string[]): void => {
    refusals.push(`${name}: ${note}`)
    rows.push({ name, status: 'fail', kind: 'semantic', note, details })
  }

  // ---- The journal must be empty before anything new is created ----

  const pending = ctx.journal.entries.length
  if (pending > 0) {
    refuse('journal.empty', `${pending} entry/entries still pending`, [
      `${ctx.journal.file} still records ${pending} mutation(s) a previous ` +
        'run created and did not tear down. Drain it first: ' +
        '`mutate --cleanup-only`.',
      ...ctx.journal.entries.map(
        entry =>
          `pending: ${entry.kind} ${entry.label} (${entry.state}` +
          `${entry.jobId ? `, job ${entry.jobId}` : ''}, claimed ${entry.claimedAt})`,
      ),
    ])
  } else {
    rows.push({
      name: 'journal.empty',
      status: 'pass',
      kind: 'semantic',
      note: 'nothing pending',
    })
  }

  if (ctx.journal.residue.length > 0) {
    rows.push({
      name: 'journal.residue',
      status: 'skipped',
      kind: 'semantic',
      note: `${ctx.journal.residue.length} artefact(s) this script cannot remove`,
      details: [
        'These were created by an earlier run and have no API that can ' +
          'delete them. They are reported here until a human clears them out ' +
          `of MinIO/the library and removes them from ${ctx.journal.file}.`,
        ...ctx.journal.residue.map(
          entry =>
            `${entry.kind} ${entry.label}` +
            `${entry.jobId ? ` (job ${entry.jobId})` : ''}: ${entry.reason}`,
        ),
      ],
    })
  }

  // ---- Movie: must resolve, must not be in the library ----

  if (wants(ctx, 'movie')) {
    const key = movieKey(ctx.fixtures)
    const detail = await ctx.request({
      path: `/download/media/${encodeURIComponent(key)}`,
      schema: MediaDetailResponseSchema,
    })

    if (!detail.ok) {
      refuse('movie.resolves', 'could not be resolved', [
        detail.reason,
        'Without a trustworthy answer here there is no way to tell whether ' +
          'the title is already in the library, so the movie pass must not run.',
      ])
    } else if (detail.data.media.type !== 'movie') {
      refuse('movie.resolves', `resolved as ${detail.data.media.type}`, [
        `${key} is supposed to be a movie. Fix fixtures.json.`,
      ])
    } else if (detail.data.media.title === detail.data.media.id) {
      // `MediaResolverService` emits a placeholder whose title *is* the key
      // when the upstream lookup throws. A placeholder also has no
      // `radarrId`, which would read as "not in the library" — the single
      // most dangerous false negative this preflight could produce.
      refuse('movie.resolves', 'Radarr returned a degraded placeholder', [
        `The resolver answered with title === id (${key}), which is the ` +
          'placeholder it emits when the Radarr lookup throws. A placeholder ' +
          'carries no radarrId, so "not in the library" cannot be ' +
          'distinguished from "Radarr is down". Fix Radarr, then re-run.',
      ])
    } else if (detail.data.media.radarrId !== undefined) {
      refuse('movie.not-in-library', 'already in the Radarr library', [
        `${key} resolves with radarrId ${detail.data.media.radarrId}, which ` +
          'means Radarr already holds it. Teardown would delete a real ' +
          'library entry that this script did not create. Pick a different ' +
          'tmdbId in fixtures.json.',
      ])
    } else {
      rows.push({
        name: 'movie.not-in-library',
        status: 'pass',
        kind: 'semantic',
        note: `${detail.data.media.title} (${detail.data.media.year ?? '?'}) — not in the library`,
        details: titleAdvisory(
          detail.data.media.title,
          ctx.fixtures.movie.title,
        ),
      })
    }
  }

  // ---- Show: must resolve, must not be in the library ----

  let showScope: ShowScopePlan = {
    kind: 'skip',
    reason: 'the show pass was not selected',
  }

  if (wants(ctx, 'show')) {
    showScope = await preflightShow(ctx, rows, refuse)
  }

  // ---- Video: nothing to refuse, but say what is and is not checked ----

  if (wants(ctx, 'video')) {
    rows.push(await preflightVideo(ctx))
  }

  return { rows, refusals, showScope }
}

type Refuse = (name: string, note: string, details: string[]) => void

async function preflightShow(
  ctx: MutateContext,
  rows: ReportRow[],
  refuse: Refuse,
): Promise<ShowScopePlan> {
  const key = showKey(ctx.fixtures)

  const detail = await ctx.request({
    path: `/download/media/${encodeURIComponent(key)}`,
    schema: MediaDetailResponseSchema,
  })

  if (!detail.ok) {
    refuse('show.resolves', 'could not be resolved', [
      detail.reason,
      'Without a trustworthy answer here there is no way to tell whether ' +
        'the series is already in the library, so the show pass must not run.',
    ])
    return { kind: 'skip', reason: 'the series could not be resolved' }
  }

  if (detail.data.media.type !== 'show') {
    refuse('show.resolves', `resolved as ${detail.data.media.type}`, [
      `${key} is supposed to be a show. Fix fixtures.json.`,
    ])
    return { kind: 'skip', reason: 'the fixture is not a show' }
  }

  if (detail.data.media.title === detail.data.media.id) {
    refuse('show.resolves', 'Sonarr returned a degraded placeholder', [
      `The resolver answered with title === id (${key}), the placeholder it ` +
        'emits when the Sonarr lookup throws. A placeholder carries no ' +
        'sonarrId, so "not in the library" cannot be distinguished from ' +
        '"Sonarr is down".',
    ])
    return { kind: 'skip', reason: 'Sonarr returned a placeholder' }
  }

  const inLibrary = detail.data.media.sonarrId !== undefined
  if (inLibrary) {
    refuse('show.not-in-library', 'already in the Sonarr library', [
      `${key} resolves with sonarrId ${detail.data.media.sonarrId}, which ` +
        'means Sonarr already holds it. Teardown deletes the **series** ' +
        '(deleteFiles: true), so running against a series someone else added ' +
        "would destroy that person's episodes. Pick a different tvdbId.",
    ])
  } else {
    rows.push({
      name: 'show.not-in-library',
      status: 'pass',
      kind: 'semantic',
      note: `${detail.data.media.title} — not in the library`,
      details: [
        ...titleAdvisory(detail.data.media.title, ctx.fixtures.show.title),
        `fixtures.json declares expectedEpisodes: ${ctx.fixtures.show.expectedEpisodes}. ` +
          'That is a human-vetted advisory value and is NOT enforced here: ' +
          "Sonarr's series lookup reports statistics.episodeCount: 0 for a " +
          'series it does not hold, so there is no count to check until after ' +
          'the add.',
      ],
    })
  }

  // ---- Season count + scope selection, both off the one seasons call ----

  const fixtureSeason = ctx.fixtures.show.seasonNumber
  const seasonLabel = `season ${fixtureSeason}${fixtureSeason === 0 ? ' (specials)' : ''}`

  const seasons = await ctx.request({
    path: `/download/media/${encodeURIComponent(key)}/seasons`,
    schema: ListSeasonsResponseSchema,
  })

  // The fallback branch. `GET /media/:id/seasons` 404s for a series Sonarr
  // does not hold, which is the normal state for a fixture that just passed
  // the not-in-library guard — so this is the path a real run takes.
  if (!seasons.ok) {
    if (seasons.status !== 404) {
      refuse('show.season-count', 'the seasons lookup failed', [
        seasons.reason,
        'This is not the expected 404, so the season count could not be ' +
          'checked and the reason is unknown. Refusing rather than guessing.',
      ])
      return {
        kind: 'skip',
        reason: `the seasons lookup failed: ${seasons.reason}`,
      }
    }

    // ⚠️ The guard genuinely cannot run here, and that must not read as a
    // pass. Sonarr reports no statistics for a series it does not hold.
    rows.push({
      name: 'show.season-count',
      status: 'skipped',
      kind: 'semantic',
      note: 'unverifiable before the add',
      details: [
        `${key} is not in Sonarr's library, so GET ` +
          '/download/media/:id/seasons 404s and there are no upstream ' +
          'statistics to check. The seasonCount > 1 guard has nothing to ' +
          'read on this path.',
        `fixtures.json's expectedEpisodes: ${ctx.fixtures.show.expectedEpisodes} is the ` +
          'human-vetted stand-in for that ceiling. It is advisory and NOT ' +
          "enforceable pre-add: Sonarr's series lookup reports " +
          'statistics.episodeCount: 0 for a series it does not hold.',
      ],
    })

    const label = `${seasonLabel} (season-scoped — no episodeId is obtainable pre-add)`
    rows.push({
      name: 'show.scope',
      status: 'pass',
      kind: 'semantic',
      note: label,
      details: [
        'The show pass will POST /download/shows {tvdbId, seasonNumber} — ' +
          'one SeasonSearch, never a bare {tvdbId}. This needs no prior ' +
          'lookup: SonarrService.resolveScope() returns a season-only scope ' +
          'unchanged as its first statement (the episode round trip only ' +
          'happens for an episodeId), and triggerScopedSearch fires ' +
          'triggerSeasonSearch on the seasonNumber != null branch.',
        'An episodeId would be narrower, but the only route that exposes one ' +
          'is the seasons route that just 404d.',
      ],
    })
    return { kind: 'season', seasonNumber: fixtureSeason, label }
  }

  // Season 0 is Sonarr's specials season and is never what "how many seasons
  // does this have" means.
  const realSeasons = seasons.data.seasons.filter(
    season => season.seasonNumber > 0,
  )

  if (realSeasons.length > 1) {
    refuse('show.season-count', `${realSeasons.length} seasons — refused`, [
      `${key} reports ${realSeasons.length} non-special seasons. This ` +
        'script only ever touches a single-season fixture. Scoping bounds ' +
        'the *search* to one episode or one season, but a fresh add still ' +
        "uses addOptions.monitor: 'all', so every episode of every season " +
        "ends up monitored and reachable by Sonarr's RSS sync until " +
        'teardown runs. Keeping the fixture to one season keeps that window ' +
        'as small as it can be.',
    ])
    return { kind: 'skip', reason: 'the fixture has more than one season' }
  }

  rows.push({
    name: 'show.season-count',
    status: 'pass',
    kind: 'semantic',
    note: `${realSeasons.length} non-special season(s)`,
    details: [
      `fixtures.json's expectedEpisodes: ${ctx.fixtures.show.expectedEpisodes} remains ` +
        'advisory — it is a human-vetted ceiling, not something this script ' +
        'enforces.',
    ],
  })

  // The preferred branch: narrowest scope wins. Episodes are taken from the
  // fixture's own declared season — `===`, so season 0 is matched like any
  // other rather than falling foul of a truthiness check.
  const target = seasons.data.seasons.find(
    season => season.seasonNumber === fixtureSeason,
  )

  const candidate = (target?.episodes ?? [])
    .filter(episode => !episode.hasFile)
    .sort((a, b) => a.episodeNumber - b.episodeNumber)[0]

  if (!candidate) {
    const label = `${seasonLabel} (season-scoped)`
    rows.push({
      name: 'show.scope',
      status: 'pass',
      hollow: true,
      kind: 'semantic',
      note: label,
      details: [
        target === undefined
          ? `Sonarr's season list has no ${seasonLabel}, so no episodeId ` +
            'could be picked from it.'
          : `Every episode of ${seasonLabel} already has a file, so there is ` +
            'no fileless episode to narrow to.',
        'Falling back to the season scope: POST /download/shows ' +
          '{tvdbId, seasonNumber}, one SeasonSearch.',
      ],
    })
    return { kind: 'season', seasonNumber: fixtureSeason, label }
  }

  const label =
    `S${String(candidate.seasonNumber).padStart(2, '0')}` +
    `E${String(candidate.episodeNumber).padStart(2, '0')}` +
    `${candidate.title ? ` ${candidate.title}` : ''} (episodeId ${candidate.id})`

  rows.push({
    name: 'show.scope',
    // The series being in the library is itself a refusal, so this row is
    // reporting what *would* have been requested rather than what will be.
    status: inLibrary ? 'skipped' : 'pass',
    kind: 'semantic',
    note: label,
    details: [
      'The show pass will POST /download/shows {tvdbId, episodeId} — ' +
        'episode-scoped, the narrowest scope available, and never a bare ' +
        '{tvdbId}. That is one EpisodeSearch for one episode.',
    ],
  })

  return {
    kind: 'episode',
    episodeId: candidate.id,
    seasonNumber: candidate.seasonNumber,
    label,
  }
}

/**
 * The video fixture has no id to collide with — a request mints a fresh
 * `video:<nanoid>` key every time — so there is nothing to refuse. What is
 * worth reporting is whether the same URL has already been fetched, and that
 * this pass cannot fully clean up after itself.
 */
async function preflightVideo(ctx: MutateContext): Promise<ReportRow> {
  const details = [
    `${ctx.fixtures.video.url} ` +
      `[${ctx.fixtures.video.timeRange.start}–${ctx.fixtures.video.timeRange.end}]`,
    'Each request mints a fresh video: key, so there is no id to collide ' +
      'with and nothing to refuse. Teardown is DELETE /download/videos/:jobId, ' +
      "which stops the job, removes its MinIO objects and clears the row's " +
      'download URLs - so this pass cleans up after itself like the movie and ' +
      'show ones do.',
  ]

  const activity = await ctx.request({
    path: `/download/activity?limit=${ORPHAN_SCAN_LIMIT}&type=video`,
    schema: ActivityPageSchema,
  })

  if (activity.ok) {
    const existing = activity.data.items.filter(
      item =>
        item.media.type === 'video' &&
        item.media.sourceUrl === ctx.fixtures.video.url,
    )
    if (existing.length > 0) {
      details.push(
        `Advisory: ${existing.length} job(s) on the activity feed already ` +
          'have this source URL. Not a refusal — a duplicate download is ' +
          'additive and cannot damage the first — but the gallery will show ' +
          'more than one copy until they are cleared.',
      )
    }
  } else {
    details.push(`Could not scan the activity feed: ${activity.reason}`)
  }

  return {
    name: 'video.fixture',
    status: 'pass',
    kind: 'semantic',
    note: 'nothing to refuse',
    details,
  }
}

function titleAdvisory(actual: string, expected: string): string[] {
  return actual.toLowerCase() === expected.toLowerCase()
    ? []
    : [
        `Advisory: the upstream title is "${actual}" but fixtures.json says ` +
          `"${expected}". Catalogue ids get reused and retitled — check this ` +
          'is still the title you meant before running mutate.',
      ]
}

function wants(ctx: MutateContext, kind: MutationKind): boolean {
  return ctx.only === undefined || ctx.only === kind
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

const JOB_PATH: Readonly<Record<MutationKind, string>> = {
  movie: '/download/movies',
  show: '/download/shows',
  video: '/download/videos',
}

interface PollResult {
  /** Every distinct status seen, in order, starting with the POST's own. */
  observed: DownloadJobStatus[]
  /** Transitions the state machine does not allow. Each one is a failure. */
  illegal: string[]
  /** The last error the job carried, if any. */
  error?: string
  /** Set when a poll could not be completed at all. */
  pollFailure?: string
  mediaId: string
  reachedTerminal: boolean
  elapsedMs: number
}

/**
 * Watches a job move, and asserts only what can honestly be asserted.
 *
 * **Forward movement, not completion.** A real grab depends on an indexer
 * actually holding the release, so `Completed` may legitimately never arrive —
 * asserting it would make this script fail on a healthy backend. What is
 * assertable is that every transition observed is one the state machine allows,
 * and the poll stops as soon as the job is terminal.
 */
async function pollJob(
  ctx: MutateContext,
  kind: MutationKind,
  jobId: string,
  initial: { status: DownloadJobStatus; mediaId: string; error?: string },
  window: { intervalMs: number; windowMs: number },
): Promise<PollResult> {
  const observed: DownloadJobStatus[] = [initial.status]
  const illegal: string[] = []
  const startedAt = Date.now()
  let error = initial.error
  let mediaId = initial.mediaId
  let current = initial.status
  let pollFailure: string | undefined

  while (
    !TERMINAL_STATUSES.has(current) &&
    Date.now() - startedAt < window.windowMs
  ) {
    await sleep(window.intervalMs)

    const attempt = await ctx.request({
      path: `${JOB_PATH[kind]}/${encodeURIComponent(jobId)}`,
      schema: DownloadJobResponseSchema,
    })

    if (!attempt.ok) {
      pollFailure = attempt.reason
      break
    }

    mediaId = attempt.data.media.id
    error = attempt.data.error ?? error
    const next = attempt.data.status

    if (next === current) {
      continue
    }

    if (!isReachable(kind, current, next)) {
      illegal.push(`${current} → ${next}`)
    }
    observed.push(next)
    current = next
  }

  return {
    observed,
    illegal,
    ...(error ? { error } : {}),
    ...(pollFailure ? { pollFailure } : {}),
    mediaId,
    reachedTerminal: TERMINAL_STATUSES.has(current),
    elapsedMs: Date.now() - startedAt,
  }
}

/** The row a completed poll produces. */
function pollRow(
  name: string,
  kind: MutationKind,
  jobId: string,
  poll: PollResult,
  extraDetails: readonly string[] = [],
): ReportRow {
  const trail = poll.observed.join(' → ')
  const details = [
    `job ${jobId}  ·  media ${poll.mediaId}  ·  ${Math.round(poll.elapsedMs / 1000)}s watched`,
    `states: ${trail}`,
    ...extraDetails,
  ]

  if (poll.error) {
    details.push(`job error: ${poll.error}`)
  }

  if (poll.illegal.length > 0) {
    return {
      name,
      status: 'fail',
      kind: 'semantic',
      note: `illegal transition: ${poll.illegal.join(', ')}`,
      details: [
        'The job moved between two states the state machine does not ' +
          'connect. Either the machine drifted or something wrote a status ' +
          'out of band — this is the finding, not the trail above.',
        ...details,
      ],
    }
  }

  if (poll.pollFailure) {
    return {
      name,
      status: 'fail',
      kind: 'semantic',
      note: 'the job stopped answering mid-poll',
      details: [poll.pollFailure, ...details],
    }
  }

  const last = poll.observed[poll.observed.length - 1]

  if (last === DownloadJobStatus.Failed) {
    return {
      name,
      status: 'fail',
      kind: 'semantic',
      note: 'the job failed',
      details,
    }
  }

  // One observation means the job never left the state the POST returned it
  // in. For a movie/show that is `Searching`, which is a legitimate resting
  // place; for a video it means the pipeline never started, which is not.
  if (poll.observed.length === 1) {
    return {
      name,
      status: kind === 'video' ? 'fail' : 'pass',
      hollow: kind !== 'video',
      kind: 'semantic',
      note:
        kind === 'video'
          ? `never left ${last} — the pipeline did not start`
          : `still ${last} after the window — no forward movement observed`,
      details: [
        kind === 'video'
          ? 'A video job should reach Downloading within seconds of being ' +
            'queued. Check MAX_DOWNLOADS and the scheduler.'
          : 'Not a failure: a grab needs an indexer to actually hold the ' +
            'release, so a job can sit in Searching indefinitely. The write ' +
            'path was exercised (the request reached Sonarr/Radarr and the ' +
            'job was accepted); the download path was not.',
        ...details,
      ],
    }
  }

  return {
    name,
    status: 'pass',
    kind: 'semantic',
    note: `advanced through ${poll.observed.length} states, ending ${last}`,
    details,
  }
}

// ---------------------------------------------------------------------------
// The three passes
// ---------------------------------------------------------------------------

interface PassOutcome {
  rows: ReportRow[]
}

async function runMoviePass(ctx: MutateContext): Promise<PassOutcome> {
  const key = movieKey(ctx.fixtures)
  const label = `${ctx.fixtures.movie.title} (${ctx.fixtures.movie.year}) ${key}`
  const rows: ReportRow[] = []

  // Durable *before* the POST. Everything after this point is recoverable.
  const claim = await ctx.journal.claim({
    kind: 'movie',
    label,
    mediaId: key,
  })

  try {
    const created = await ctx.request({
      method: 'POST',
      path: '/download/movies',
      json: { tmdbId: ctx.fixtures.movie.tmdbId },
      schema: DownloadJobResponseSchema,
    })

    if (!created.ok) {
      rows.push({
        name: 'movie.create',
        status: 'fail',
        kind: 'semantic',
        note: 'POST /download/movies failed',
        details: [created.reason],
      })
      return { rows }
    }

    const job = created.data
    await ctx.journal.attach(claim, job.id, job.media.id)

    rows.push({
      name: 'movie.create',
      status: 'pass',
      kind: 'semantic',
      note: `job ${job.id} created as ${job.status}`,
      httpStatus: created.status,
      durationMs: created.durationMs,
      details: [`${label} → ${job.media.id}`],
    })

    const poll = await pollJob(
      ctx,
      'movie',
      job.id,
      { status: job.status, mediaId: job.media.id, error: job.error },
      { intervalMs: MEDIA_POLL_INTERVAL_MS, windowMs: MEDIA_POLL_WINDOW_MS },
    )
    rows.push(pollRow('movie.progress', 'movie', job.id, poll))
  } catch (error) {
    rows.push(threwRow('movie.create', error))
  } finally {
    rows.push(...(await cleanupEntry(ctx, claim.entryId, 'movie.cleanup')))
    if (!ctx.keep) {
      rows.push(await confirmGone(ctx, 'movie', key))
    }
  }

  return { rows }
}

async function runShowPass(
  ctx: MutateContext,
  plan: ShowScopePlan,
): Promise<PassOutcome> {
  if (plan.kind === 'skip') {
    return {
      rows: [
        {
          name: 'show.create',
          status: 'skipped',
          kind: 'semantic',
          note: 'no usable scope — nothing was requested',
          details: [
            plan.reason,
            'Deliberately NOT falling back to POST /download/shows {tvdbId}: ' +
              'that is a whole-series request, which is the exact blast ' +
              'radius this pass exists to avoid. A season-scoped request is ' +
              'the widest thing this pass will ever send.',
          ],
        },
      ],
    }
  }

  const key = showKey(ctx.fixtures)
  const label = `${ctx.fixtures.show.title} ${key} ${plan.label}`
  const rows: ReportRow[] = []

  // The request body, chosen by scope. Both branches carry exactly one
  // narrowing axis, and there is no branch that carries none.
  const body =
    plan.kind === 'episode'
      ? { tvdbId: ctx.fixtures.show.tvdbId, episodeId: plan.episodeId }
      : { tvdbId: ctx.fixtures.show.tvdbId, seasonNumber: plan.seasonNumber }

  const claim = await ctx.journal.claim({ kind: 'show', label, mediaId: key })

  try {
    const created = await ctx.request({
      method: 'POST',
      path: '/download/shows',
      // Scoped. Never `{ tvdbId }` alone — see the module docblock.
      json: body,
      schema: DownloadJobResponseSchema,
    })

    if (!created.ok) {
      rows.push({
        name: 'show.create',
        status: 'fail',
        kind: 'semantic',
        note: 'POST /download/shows failed',
        details: [created.reason],
      })
      return { rows }
    }

    const job = created.data
    await ctx.journal.attach(claim, job.id, job.media.id)

    rows.push({
      name: 'show.create',
      status: 'pass',
      kind: 'semantic',
      note: `job ${job.id} created as ${job.status}`,
      httpStatus: created.status,
      durationMs: created.durationMs,
      details: [
        `${label} → ${job.media.id}`,
        `sent: ${JSON.stringify(body)}`,
        `scope on the job: ${JSON.stringify(job.scope ?? null)}`,
        ...scopeRoundTrip(plan, job.scope),
      ],
    })

    const poll = await pollJob(
      ctx,
      'show',
      job.id,
      { status: job.status, mediaId: job.media.id, error: job.error },
      { intervalMs: MEDIA_POLL_INTERVAL_MS, windowMs: MEDIA_POLL_WINDOW_MS },
    )
    rows.push(pollRow('show.progress', 'show', job.id, poll))
  } catch (error) {
    rows.push(threwRow('show.create', error))
  } finally {
    rows.push(
      ...(await cleanupEntry(ctx, claim.entryId, 'show.cleanup', [
        'Teardown is DELETE /download/shows/:jobId, which runs ' +
          'sonarrService.unmonitorAndDelete() — it cancels the queue items ' +
          'and then deletes the **series** with deleteFiles: true. ' +
          "Unmonitoring alone would not do: the add's addOptions.monitor: " +
          "'all' leaves every episode monitored and RSS-reachable.",
      ])),
    )
    if (!ctx.keep) {
      rows.push(await confirmGone(ctx, 'show', key))
    }
  }

  return { rows }
}

/**
 * Did the scope survive the round trip, and which upstream search does that
 * imply?
 *
 * The failure this is watching for is an **empty** scope coming back: that is
 * what a whole-series request looks like on the job row, and it would mean the
 * narrowing axis was dropped somewhere between the body and
 * `triggerScopedSearch` — a `SeriesSearch` where one episode or one season was
 * asked for.
 *
 * Every comparison is `!= null`/`===`, never truthiness: season 0 is Sonarr's
 * specials season and a legitimate value.
 */
function scopeRoundTrip(
  plan: ShowScopePlan,
  scope: { episodeId?: number; seasonNumber?: number } | undefined,
): string[] {
  if (plan.kind === 'skip') {
    return []
  }

  if (scope === undefined) {
    return [
      '⚠ The job came back with NO scope at all, which is what a ' +
        'whole-series request looks like. The narrowing axis was dropped — ' +
        'this is a SeriesSearch, not the scoped search that was asked for.',
    ]
  }

  if (plan.kind === 'episode') {
    return scope.episodeId === plan.episodeId
      ? ['The scope round-tripped: one EpisodeSearch, not a SeriesSearch.']
      : [
          `⚠ Requested episodeId ${plan.episodeId} but the job carries ` +
            `${scope.episodeId ?? 'none'}. triggerScopedSearch picks its ` +
            'command off this scope, so the search that ran is not the one ' +
            'that was asked for.',
        ]
  }

  return scope.seasonNumber === plan.seasonNumber
    ? [
        `The scope round-tripped: one SeasonSearch for season ` +
          `${plan.seasonNumber}, not a SeriesSearch. resolveScope() returns a ` +
          'season-only scope unchanged, so no episode lookup was needed.',
      ]
    : [
        `⚠ Requested seasonNumber ${plan.seasonNumber} but the job carries ` +
          `${scope.seasonNumber ?? 'none'}. triggerScopedSearch picks its ` +
          'command off this scope, so the search that ran is wider than the ' +
          'one that was asked for.',
      ]
}

async function runVideoPass(ctx: MutateContext): Promise<PassOutcome> {
  const label = ctx.fixtures.video.url
  const rows: ReportRow[] = []

  const claim = await ctx.journal.claim({
    kind: 'video',
    label,
    sourceUrl: ctx.fixtures.video.url,
  })

  try {
    const created = await ctx.request({
      method: 'POST',
      path: '/download/videos',
      json: {
        url: ctx.fixtures.video.url,
        timeRange: ctx.fixtures.video.timeRange,
      },
      schema: DownloadJobResponseSchema,
    })

    if (!created.ok) {
      rows.push({
        name: 'video.create',
        status: 'fail',
        kind: 'semantic',
        note: 'POST /download/videos failed',
        details: [created.reason],
      })
      return { rows }
    }

    const job = created.data
    await ctx.journal.attach(claim, job.id, job.media.id)

    rows.push({
      name: 'video.create',
      status: 'pass',
      kind: 'semantic',
      note: `job ${job.id} created as ${job.status}`,
      httpStatus: created.status,
      durationMs: created.durationMs,
      details: [`${label} → ${job.media.id}`],
    })

    const poll = await pollJob(
      ctx,
      'video',
      job.id,
      { status: job.status, mediaId: job.media.id, error: job.error },
      { intervalMs: VIDEO_POLL_INTERVAL_MS, windowMs: VIDEO_POLL_WINDOW_MS },
    )
    rows.push(pollRow('video.progress', 'video', job.id, poll))

    const last = poll.observed[poll.observed.length - 1]
    if (last === DownloadJobStatus.Completed) {
      rows.push(await confirmObject(ctx, poll.mediaId))
    } else {
      rows.push({
        name: 'video.object',
        status: 'skipped',
        kind: 'semantic',
        note: `job ended ${last} — no object to confirm`,
      })
    }
  } catch (error) {
    rows.push(threwRow('video.create', error))
  } finally {
    rows.push(...(await cleanupEntry(ctx, claim.entryId, 'video.cleanup')))
  }

  return { rows }
}

/**
 * The MinIO object, confirmed through the app's own file route with the body
 * discarded. `bodyMode: 'headers-only'` is not an optimisation here: the MinIO
 * branch of `GET /media/:id/file` deliberately ignores `Range`
 * (`download.controller.ts:543-545`), so asking for less is not possible.
 */
async function confirmObject(
  ctx: MutateContext,
  mediaId: string,
): Promise<ReportRow> {
  const attempt = await ctx.request({
    path: `/download/media/${encodeURIComponent(mediaId)}/file`,
    // No schema: this route answers with bytes, not JSON.
    bodyMode: 'headers-only',
  })

  if (attempt.ok) {
    const length = attempt.headers['content-length']
    const type = attempt.headers['content-type']
    const bytes = Number(length)
    const empty = Number.isFinite(bytes) && bytes === 0

    return {
      name: 'video.object',
      status: empty ? 'fail' : 'pass',
      kind: 'semantic',
      note: empty
        ? 'the object exists but is zero bytes'
        : 'the MinIO object is served back',
      httpStatus: attempt.status,
      details: [
        `content-type: ${type ?? '(none)'}  ·  content-length: ${length ?? '(none)'}`,
        `GET /download/media/${mediaId}/file answered 200, so ` +
          'MediaFileService resolved the object and MinIO handed it over. The ' +
          'body was discarded unread — that branch ignores Range, so there is ' +
          'no way to ask for less than the whole object.',
      ],
    }
  }

  return {
    name: 'video.object',
    status: 'fail',
    kind: 'semantic',
    note: 'the MinIO object could not be fetched',
    httpStatus: attempt.status,
    details: [
      attempt.reason,
      'The job reported Completed, which means the upload step returned — so ' +
        'either the object never landed or the read path cannot find it.',
    ],
  }
}

/**
 * After teardown, the title must be back out of the library. Checked through
 * `radarrId`/`sonarrId` rather than by re-fetching the job: `deleteJob()`
 * leaves the job row behind as `Cancelled`, so the job is *not* gone — the
 * library entry is what teardown actually removed.
 */
async function confirmGone(
  ctx: MutateContext,
  kind: 'movie' | 'show',
  key: string,
): Promise<ReportRow> {
  const name = `${kind}.gone`
  const attempt = await ctx.request({
    path: `/download/media/${encodeURIComponent(key)}`,
    schema: MediaDetailResponseSchema,
  })

  if (!attempt.ok) {
    return {
      name,
      status: 'fail',
      kind: 'semantic',
      note: 'could not confirm the library entry is gone',
      details: [attempt.reason],
    }
  }

  const media = attempt.data.media
  const upstreamId =
    media.type === 'movie'
      ? media.radarrId
      : media.type === 'show'
        ? media.sonarrId
        : undefined

  if (upstreamId === undefined) {
    return {
      name,
      status: 'pass',
      kind: 'semantic',
      note: 'out of the library again',
      details: [
        `${key} resolves without a ${kind === 'movie' ? 'radarrId' : 'sonarrId'}, ` +
          'which is what a title that is merely known-about (not held) looks ' +
          'like. The job row itself survives as Cancelled by design.',
      ],
    }
  }

  return {
    name,
    status: 'fail',
    kind: 'semantic',
    note: `still in the library as ${upstreamId}`,
    details: [
      `Teardown ran but ${key} still resolves with an upstream id. Something ` +
        'this script created is still in the library — remove it by hand.',
      // The resolver caches the library listing; `deleteJob()` invalidates the
      // key, but a race with an in-flight resolve can still serve a stale one.
      'Worth re-checking once before acting: MediaResolverService caches the ' +
        'library listing and a concurrent read can repopulate it.',
    ],
  }
}

function threwRow(name: string, error: unknown): ReportRow {
  return {
    name,
    status: 'fail',
    kind: 'semantic',
    note: 'the pass threw',
    details: [
      describe(error),
      'Cleanup still ran — it lives in a finally, not on the happy path.',
    ],
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Tears down one journal entry, whatever state it is in. Shared verbatim by
 * every pass's `finally` and by `--cleanup-only`, so the crash-recovery path
 * is the same code the happy path uses rather than a second implementation
 * that only ever runs when something has already gone wrong.
 */
async function cleanupEntry(
  ctx: MutateContext,
  entryId: string,
  name: string,
  extraDetails: readonly string[] = [],
): Promise<ReportRow[]> {
  const entry = ctx.journal.entries.find(
    candidate => candidate.entryId === entryId,
  )

  if (!entry) {
    // Already drained — by an earlier `finally`, or by a `--cleanup-only` in
    // another terminal.
    return []
  }

  if (ctx.keep) {
    return [
      {
        name,
        status: 'skipped',
        kind: 'semantic',
        note: '--keep — nothing was torn down',
        details: [
          `${entry.kind} ${entry.label}` +
            `${entry.jobId ? ` (job ${entry.jobId})` : ''} is still live and ` +
            `still journalled in ${ctx.journal.file}. Run ` +
            '`mutate --cleanup-only` when you are done looking at it.',
        ],
      },
    ]
  }

  let ticket = ctx.journal.ticketFor(entryId)

  if (!ticket) {
    // A `claimed` entry: the journal write landed but the POST's answer did
    // not. Recover the job id from the activity feed, then tear down normally.
    const recovered = await resolveOrphanClaim(ctx, entry)
    if (recovered.kind === 'none') {
      await ctx.journal.drop(entryId)
      return [
        {
          name,
          status: 'pass',
          kind: 'semantic',
          note: 'nothing was created',
          details: [
            `${entry.kind} ${entry.label} was journalled but no matching job ` +
              'exists on the activity feed, so the POST never landed. The ' +
              'entry has been dropped.',
            recovered.detail,
          ],
        },
      ]
    }
    if (recovered.kind === 'unresolved') {
      return [
        {
          name,
          status: 'fail',
          kind: 'semantic',
          note: 'orphaned claim — could not be resolved',
          details: [
            `${entry.kind} ${entry.label} was journalled and the POST may or ` +
              'may not have landed. The entry is being kept so a later ' +
              '`mutate --cleanup-only` can retry it.',
            recovered.detail,
          ],
        },
      ]
    }
    ticket = await ctx.journal.attach(
      recovered.claim,
      recovered.jobId,
      recovered.mediaId,
    )
    extraDetails = [
      ...extraDetails,
      `Recovered an orphaned claim: job ${recovered.jobId} was matched off ` +
        'the activity feed by media key and creation time.',
    ]
  }

  const outcome = await ctx.journal.destroy(ctx.request, ticket)

  if (outcome.kind === 'deleted') {
    return [
      {
        name,
        status: 'pass',
        kind: 'semantic',
        note: `torn down (${entry.kind} job ${ticket.jobId})`,
        httpStatus: outcome.status,
        details: [...extraDetails],
      },
    ]
  }

  if (outcome.kind === 'gone') {
    // A video whose *job* the backend no longer has is a different problem
    // from a movie's: the job row is what addresses the MinIO objects, so
    // without it nothing can name them any more. `DELETE /videos/:jobId`
    // resolves the job from the durable row (`adoptJob`), so this branch now
    // means the row itself is gone - rare, and still worth residue rather
    // than a silent drain.
    if (entry.kind === 'video') {
      await ctx.journal.retire(
        entryId,
        'the backend has no job row for this video, so nothing can name the ' +
          'MinIO objects it produced',
      )
      return [
        {
          name,
          status: 'fail',
          kind: 'semantic',
          note: 'cannot be torn down — recorded as residue',
          httpStatus: outcome.status,
          details: [
            outcome.detail,
            `⚠ ${entry.mediaId ?? 'the video'} may still be in MinIO. ` +
              'DELETE /download/videos/:jobId is addressed by job id and ' +
              'resolves it from the durable jobs row, so a 404 here means ' +
              'that row is gone too. Remove the object by hand, then clear ' +
              `the residue list in ${ctx.journal.file}.`,
            ...extraDetails,
          ],
        },
      ]
    }

    // A movie or show the backend no longer has a job for. That is the state
    // teardown was asking for, so the entry is drained rather than retried —
    // an entry that can never succeed would make the journal permanently
    // un-drainable and train the reader to ignore it.
    await ctx.journal.drop(entryId)
    return [
      {
        name,
        status: 'pass',
        hollow: true,
        kind: 'semantic',
        note: 'already gone',
        httpStatus: outcome.status,
        details: [
          outcome.detail,
          'The backend has no such job any more, which is the state teardown ' +
            'asked for. ⚠ It cannot confirm the upstream library entry went ' +
            `with it — the ${entry.kind}.gone row below is what does that.`,
          ...extraDetails,
        ],
      },
    ]
  }

  return [
    {
      name,
      status: 'fail',
      kind: 'semantic',
      note: 'teardown failed — the entry is still journalled',
      httpStatus: outcome.status,
      details: [
        outcome.detail,
        `${entry.kind} ${entry.label} (job ${ticket.jobId}) is still live. ` +
          'Retry with `mutate --cleanup-only`; the journal entry survives ' +
          'until it succeeds.',
        ...extraDetails,
      ],
    },
  ]
}

type OrphanResolution =
  | { kind: 'found'; jobId: string; mediaId: string; claim: MutationClaim }
  | { kind: 'none'; detail: string }
  | { kind: 'unresolved'; detail: string }

/**
 * Turns a `claimed` entry back into a job id by scanning the activity feed.
 *
 * This is what makes "journal before create" more than a note-to-self: the
 * claim records the fixture identity (a media key, or the video's source URL)
 * plus the moment it was written, and a job created by that POST is the one
 * with the same identity created at or after that moment. The match is
 * deliberately narrow — the wrong side of it would be an id this script did
 * not create, and the whole allowlist exists to prevent exactly that.
 */
async function resolveOrphanClaim(
  ctx: MutateContext,
  entry: JournalEntry,
): Promise<OrphanResolution> {
  const attempt = await ctx.request({
    path: `/download/activity?limit=${ORPHAN_SCAN_LIMIT}&type=${entry.kind}`,
    schema: ActivityPageSchema,
  })

  if (!attempt.ok) {
    return {
      kind: 'unresolved',
      detail: `The activity feed could not be read: ${attempt.reason}`,
    }
  }

  const claimedAtMs = Date.parse(entry.claimedAt)
  const floor = Number.isNaN(claimedAtMs)
    ? Number.NEGATIVE_INFINITY
    : claimedAtMs - ORPHAN_CLOCK_SKEW_MS

  const matches = attempt.data.items.filter(item => {
    const createdMs = Date.parse(item.createdAt)
    if (Number.isNaN(createdMs) || createdMs < floor) {
      return false
    }
    if (entry.kind === 'video') {
      return (
        item.media.type === 'video' && item.media.sourceUrl === entry.sourceUrl
      )
    }
    return item.media.id === entry.mediaId
  })

  if (matches.length === 0) {
    return {
      kind: 'none',
      detail:
        `Nothing on the last ${ORPHAN_SCAN_LIMIT} ${entry.kind} activity rows ` +
        `matches ${entry.mediaId ?? entry.sourceUrl ?? entry.label} created ` +
        `at or after ${entry.claimedAt}.`,
    }
  }

  if (matches.length > 1) {
    return {
      kind: 'unresolved',
      detail:
        `${matches.length} activity rows match this claim ` +
        `(${matches.map(item => item.id).join(', ')}). Refusing to guess ` +
        'which one this script created — tear them down by hand, then ' +
        `remove the entry from ${ctx.journal.file}.`,
    }
  }

  const match = matches[0]
  if (!match) {
    return { kind: 'none', detail: 'no match' }
  }

  return {
    kind: 'found',
    jobId: match.id,
    mediaId: match.media.id,
    claim: {
      entryId: entry.entryId,
      kind: entry.kind,
      label: entry.label,
      claimedAt: entry.claimedAt,
    },
  }
}

/** `--cleanup-only`: drain every pending entry, whatever wrote it. */
async function drainJournal(ctx: MutateContext): Promise<ReportRow[]> {
  const entryIds = ctx.journal.entries.map(entry => entry.entryId)

  if (entryIds.length === 0) {
    return [
      {
        name: 'journal.drain',
        status: 'pass',
        hollow: true,
        kind: 'semantic',
        note: 'nothing pending',
        details: [`${ctx.journal.file} has no entries to drain.`],
      },
    ]
  }

  const rows: ReportRow[] = []
  for (const entryId of entryIds) {
    const entry = ctx.journal.entries.find(
      candidate => candidate.entryId === entryId,
    )
    const name = `drain.${entry?.kind ?? 'entry'}`
    rows.push(...(await cleanupEntry(ctx, entryId, name)))
  }
  return rows
}

// ---------------------------------------------------------------------------
// CLI plumbing
// ---------------------------------------------------------------------------

/**
 * A user error inside a mode's own `run`. Mirrors `verify-backend.ts`'s
 * `UsageError` (same `name`, same exit code) without importing it — a value
 * import in this direction would close a require cycle, since
 * `verify-backend.ts` imports the two modes below.
 */
class MutateUsageError extends Error {
  override readonly name = 'UsageError'
}

const SCRIPT = 'tsx scripts/verify/verify-backend.ts'

const CONNECTION_FLAGS: readonly FlagSpec[] = [
  {
    name: 'repo-path',
    kind: 'string',
    placeholder: '<path>',
    describe:
      'Directory holding the root docker-compose.yml, on the lilnas host. ' +
      'Required unless --base-url or --dry-run.',
  },
  {
    name: 'base-url',
    kind: 'string',
    placeholder: '<url>',
    describe:
      'Talk to an already-reachable backend (http://localhost:8081) instead ' +
      'of docker compose exec. Mutually exclusive with --repo-path.',
  },
  {
    name: 'fixtures',
    kind: 'string',
    placeholder: '<file>',
    describe: `Fixture file to read. Default: ${DEFAULT_FIXTURES_FILE}`,
  },
  {
    name: 'captures',
    kind: 'string',
    placeholder: '<dir>',
    describe: `Where the journal lives. Default: ${DEFAULT_CAPTURES_DIR}`,
  },
  {
    name: 'only',
    kind: 'string',
    placeholder: '<movie|show|video>',
    describe: 'Restrict to one pass. Default: all three.',
  },
]

const PREFLIGHT_FLAGS: readonly FlagSpec[] = CONNECTION_FLAGS

const MUTATE_FLAGS: readonly FlagSpec[] = [
  ...CONNECTION_FLAGS,
  {
    name: 'keep',
    kind: 'boolean',
    describe:
      'Do not tear anything down. The journal keeps every entry so a later ' +
      '--cleanup-only can. Leaves real content in the library.',
  },
  {
    name: 'cleanup-only',
    kind: 'boolean',
    describe:
      'Create nothing; drain the journal a previous run left behind. Safe to ' +
      'run at any time.',
  },
  {
    name: 'dry-run',
    kind: 'boolean',
    describe: 'Print the plan and exit. Touches no network and no journal.',
  },
]

interface Connection {
  transport: Transport
  describe: string
}

function resolveConnection(args: ParsedArgs): Connection {
  const repoPath = stringFlag(args, 'repo-path')
  const baseUrl = stringFlag(args, 'base-url')

  if (repoPath && baseUrl) {
    throw new MutateUsageError(
      '--repo-path and --base-url are mutually exclusive',
    )
  }
  if (repoPath) {
    return {
      transport: dockerExecTransport({ repoPath }),
      describe: `docker compose exec in ${repoPath}`,
    }
  }
  if (baseUrl) {
    return { transport: httpTransport(baseUrl), describe: baseUrl }
  }
  throw new MutateUsageError('--repo-path is required (or --base-url)')
}

function resolveOnly(args: ParsedArgs): MutationKind | undefined {
  const only = stringFlag(args, 'only')
  if (only === undefined) {
    return undefined
  }
  if (!isMutationKind(only)) {
    throw new MutateUsageError(
      `--only takes one of ${MUTATION_KINDS.join(', ')} — got "${only}"`,
    )
  }
  return only
}

async function buildContext(
  args: ParsedArgs,
  overrides: { keep?: boolean } = {},
): Promise<{ ctx: MutateContext; connection: Connection }> {
  const fixtures = await loadFixtures(
    path.resolve(stringFlag(args, 'fixtures') ?? DEFAULT_FIXTURES_FILE),
  )
  const capturesDir = path.resolve(
    stringFlag(args, 'captures') ?? DEFAULT_CAPTURES_DIR,
  )
  const connection = resolveConnection(args)

  return {
    connection,
    ctx: {
      request: makeRequest(connection.transport, {
        // Every mutation here writes an audit row, so it is attributed on
        // purpose. `AdminGuard` is irrelevant — none of these routes is
        // guarded — but an unattributed create would land as
        // `origin: 'service'` and be much harder to find later.
        'X-Forwarded-User': fixtures.adminEmail,
        'X-Forwarded-User-Id': MUTATE_USER_ID,
      }),
      journal: await MutationJournal.open(path.join(capturesDir, JOURNAL_FILE)),
      fixtures,
      capturesDir,
      only: resolveOnly(args),
      keep: overrides.keep ?? false,
    },
  }
}

function header(
  title: string,
  ctx: MutateContext,
  connection: Connection,
  warnings: string[],
): ReportHeader {
  return {
    title,
    capturesDir: ctx.journal.file,
    identity: `${ctx.fixtures.adminEmail} / ${MUTATE_USER_ID} → ${connection.describe}`,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// preflight mode
// ---------------------------------------------------------------------------

async function runPreflight(args: ParsedArgs): Promise<number> {
  try {
    const { ctx, connection } = await buildContext(args)
    const result = await preflight(ctx)

    const sections: ReportSection[] = [
      {
        title: 'Preflight',
        blurb:
          'Read-only. Nothing here creates, deletes or modifies anything — ' +
          'every request is a GET.',
        rows: result.rows,
        emptyNote: 'Nothing to check.',
      },
    ]

    console.log(
      renderReport(
        header('preflight', ctx, connection, preflightWarnings(ctx, result)),
        sections,
      ),
    )

    return exitCodeFor(sections)
  } catch (error) {
    return reportUsage(error, 'preflight')
  }
}

function preflightWarnings(
  ctx: MutateContext,
  result: PreflightResult,
): string[] {
  const warnings: string[] = []

  if (result.refusals.length > 0) {
    warnings.push(
      `${result.refusals.length} refusal(s). \`mutate\` will not run until ` +
        'every one is cleared: ' +
        result.refusals.join('; '),
    )
  }

  warnings.push(...scopeWarnings(ctx, result))

  warnings.push(
    'POST /download/media/:id/releases/grab exists and pulls real bytes from ' +
      'a real indexer into the download client. It is deliberately out of ' +
      'scope for this script and needs its own deliberate session.',
  )

  return warnings
}

/**
 * Which scope the show pass settled on, and — on the season-scoped branch —
 * that `expectedEpisodes` is the only ceiling anyone has. Shared by
 * `preflight` and `mutate` so the two reports say the same thing.
 */
function scopeWarnings(ctx: MutateContext, result: PreflightResult): string[] {
  const advisory =
    `show.expectedEpisodes (${ctx.fixtures.show.expectedEpisodes}) is a ` +
    'human-vetted advisory value and is NOT enforced — Sonarr reports ' +
    'statistics.episodeCount: 0 for a series it does not hold, so the count ' +
    'does not exist until after the add.'

  switch (result.showScope.kind) {
    case 'episode':
      return [
        `Show scope: EPISODE — ${result.showScope.label}. One EpisodeSearch, ` +
          'the narrowest scope available. ' +
          advisory,
      ]
    case 'season':
      return [
        `Show scope: SEASON ${result.showScope.seasonNumber} — one ` +
          'SeasonSearch. No episodeId is obtainable before the add, so this ' +
          'is the narrowest available scope, and the seasonCount guard has ' +
          'no upstream statistics to read on this branch. ' +
          advisory,
      ]
    default:
      return [`Show pass will be skipped: ${result.showScope.reason}`, advisory]
  }
}

export const PREFLIGHT_MODE: Mode = {
  name: 'preflight',
  summary: 'Read-only: is it safe to run the mutating pass right now?',
  usage: `${SCRIPT} preflight --repo-path <path> [flags]`,
  flags: PREFLIGHT_FLAGS,
  run: runPreflight,
}

// ---------------------------------------------------------------------------
// mutate mode
// ---------------------------------------------------------------------------

async function runMutate(args: ParsedArgs): Promise<number> {
  try {
    const keep = boolFlag(args, 'keep')
    const cleanupOnly = boolFlag(args, 'cleanup-only')
    const dryRun = boolFlag(args, 'dry-run')

    if (keep && cleanupOnly) {
      throw new MutateUsageError(
        '--keep and --cleanup-only contradict each other',
      )
    }

    if (dryRun) {
      // `return await`, not a bare `return`: a returned promise is not
      // awaited inside its own `try`, so a bare one would let a bad
      // `--fixtures` reject straight past the catch below and surface as a
      // stack trace with exit 1 instead of a usage message with exit 2.
      return await printMutatePlan(args, { keep, cleanupOnly })
    }

    const { ctx, connection } = await buildContext(args, { keep })

    return cleanupOnly
      ? await mutateCleanupOnly(ctx, connection)
      : await mutateFull(ctx, connection)
  } catch (error) {
    return reportUsage(error, 'mutate')
  }
}

async function mutateCleanupOnly(
  ctx: MutateContext,
  connection: Connection,
): Promise<number> {
  const rows = await drainJournal(ctx)
  const sections: ReportSection[] = [
    {
      title: 'Journal drain',
      blurb:
        'Nothing was created. Every row below is an entry a previous run ' +
        'journalled and this one tried to tear down.',
      rows,
      emptyNote: 'The journal was empty.',
    },
  ]

  console.log(
    renderReport(
      header('mutate --cleanup-only', ctx, connection, residueWarnings(ctx)),
      sections,
    ),
  )
  return exitCodeFor(sections)
}

async function mutateFull(
  ctx: MutateContext,
  connection: Connection,
): Promise<number> {
  const pre = await preflight(ctx)

  if (pre.refusals.length > 0) {
    const sections: ReportSection[] = [
      {
        title: 'Preflight',
        blurb: 'Nothing was created — preflight refused.',
        rows: pre.rows,
      },
    ]
    console.log(
      renderReport(
        header('mutate (refused)', ctx, connection, [
          'ABORTED before any write. ' +
            `${pre.refusals.length} refusal(s): ${pre.refusals.join('; ')}`,
        ]),
        sections,
      ),
    )
    // Always non-zero: a refusal is a refusal even if `exitCodeFor` were
    // somehow to disagree.
    return 1
  }

  const rows: ReportRow[] = []
  if (wants(ctx, 'movie')) {
    rows.push(...(await runMoviePass(ctx)).rows)
  }
  if (wants(ctx, 'show')) {
    rows.push(...(await runShowPass(ctx, pre.showScope)).rows)
  }
  if (wants(ctx, 'video')) {
    rows.push(...(await runVideoPass(ctx)).rows)
  }

  const warnings = residueWarnings(ctx)
  if (wants(ctx, 'show')) {
    warnings.push(...scopeWarnings(ctx, pre))
  }
  if (ctx.keep) {
    warnings.unshift(
      '--keep was set: NOTHING was torn down. Everything this run created is ' +
        `still live and still journalled in ${ctx.journal.file}. Run ` +
        '`mutate --cleanup-only` as soon as you are done.',
    )
  }
  if (ctx.journal.entries.length > 0 && !ctx.keep) {
    warnings.unshift(
      `${ctx.journal.entries.length} entry/entries survived teardown and are ` +
        'still journalled — something this run created is still live. Re-run ' +
        'with --cleanup-only.',
    )
  }

  const sections: ReportSection[] = [
    {
      title: 'Preflight',
      blurb: 'Read-only checks that gate everything below.',
      rows: pre.rows,
    },
    {
      title: 'Write path',
      blurb:
        'Forward movement, not completion: a grab needs an indexer to hold ' +
        'the release, so reaching Downloaded is not an assertable property.',
      rows,
      emptyNote: 'No pass was selected.',
    },
  ]

  console.log(
    renderReport(header('mutate', ctx, connection, warnings), sections),
  )
  return exitCodeFor(sections)
}

function residueWarnings(ctx: MutateContext): string[] {
  if (ctx.journal.residue.length === 0) {
    return []
  }
  return [
    `${ctx.journal.residue.length} artefact(s) in the journal's residue list ` +
      'cannot be removed by this script and are not retried: ' +
      ctx.journal.residue
        .map(entry => `${entry.kind} ${entry.label} (${entry.reason})`)
        .join('; ') +
      `. Clear them by hand, then edit ${ctx.journal.file}.`,
  ]
}

/**
 * `--dry-run` resolves the fixtures (so a broken fixture file still fails
 * loudly) and prints what would happen. It opens no transport and does not
 * touch the journal — this is how the mode is verified without a backend.
 */
async function printMutatePlan(
  args: ParsedArgs,
  flags: { keep: boolean; cleanupOnly: boolean },
): Promise<number> {
  const fixtures = await loadFixtures(
    path.resolve(stringFlag(args, 'fixtures') ?? DEFAULT_FIXTURES_FILE),
  )
  const capturesDir = path.resolve(
    stringFlag(args, 'captures') ?? DEFAULT_CAPTURES_DIR,
  )
  const only = resolveOnly(args)
  const journalFile = path.join(capturesDir, JOURNAL_FILE)

  const lines = [
    'Plan (dry run — no request is sent and the journal is not touched):',
    '',
    `  journal    ${journalFile}`,
    `  identity   ${fixtures.adminEmail} / ${MUTATE_USER_ID}`,
    `  passes     ${only ?? MUTATION_KINDS.join(', ')}`,
    `  teardown   ${flags.keep ? 'DISABLED (--keep)' : 'in a finally, per pass'}`,
    '',
  ]

  if (flags.cleanupOnly) {
    lines.push(
      '  --cleanup-only: nothing would be created. Every pending journal',
      '  entry would be torn down, and a `claimed` entry (one whose POST',
      '  never answered) would first be matched back to a job id off the',
      '  activity feed.',
      '',
    )
  }

  const steps: Record<MutationKind, string[]> = {
    movie: [
      `journal a claim for tmdb:${fixtures.movie.tmdbId}, fsync it`,
      `POST /download/movies {tmdbId: ${fixtures.movie.tmdbId}}`,
      `poll /download/movies/:id every ${MEDIA_POLL_INTERVAL_MS / 1000}s for up to ${MEDIA_POLL_WINDOW_MS / 1000}s`,
      'finally: DELETE /download/movies/:jobId, then confirm radarrId is gone',
    ],
    show: [
      `GET /download/media/tvdb:${fixtures.show.tvdbId}/seasons — narrowest scope available wins`,
      'if it answers: refuse when it reports more than one non-special season,',
      `  else POST /download/shows {tvdbId, episodeId: <first fileless episode of season ${fixtures.show.seasonNumber}>}  → one EpisodeSearch`,
      `if it 404s (the series is not in the library — the normal case): season count is UNVERIFIABLE,`,
      `  and POST /download/shows {tvdbId: ${fixtures.show.tvdbId}, seasonNumber: ${fixtures.show.seasonNumber}}  → one SeasonSearch, no prior lookup needed`,
      'a bare {tvdbId} is never sent on any branch',
      `journal a claim for tvdb:${fixtures.show.tvdbId}, fsync it, then POST`,
      `poll /download/shows/:id every ${MEDIA_POLL_INTERVAL_MS / 1000}s for up to ${MEDIA_POLL_WINDOW_MS / 1000}s`,
      'assert the scope round-tripped onto the job (an empty scope = SeriesSearch)',
      'finally: DELETE /download/shows/:jobId (deletes the SERIES), then confirm sonarrId is gone',
    ],
    video: [
      'journal a claim for the source URL, fsync it',
      `POST /download/videos {url: ${fixtures.video.url}, timeRange: ${fixtures.video.timeRange.start}–${fixtures.video.timeRange.end}}`,
      `poll /download/videos/:id every ${VIDEO_POLL_INTERVAL_MS / 1000}s for up to ${VIDEO_POLL_WINDOW_MS / 1000}s`,
      'if Completed: GET /download/media/video:<id>/file to confirm the MinIO object',
      'finally: PATCH /download/videos/:jobId/cancel — which 404s once the job is Completed, so the object becomes journal residue',
    ],
  }

  for (const kind of MUTATION_KINDS) {
    if (only !== undefined && only !== kind) {
      continue
    }
    lines.push(`  ${kind}`)
    for (const step of steps[kind]) {
      lines.push(`    - ${step}`)
    }
    lines.push('')
  }

  lines.push(
    '  Every teardown goes through MutationJournal.destroy(), which accepts',
    '  a CleanupTicket the journal minted and re-reads the journal off disk',
    '  before sending anything. There is no code path in this file that can',
    '  delete an id the journal does not hold.',
  )

  console.log(lines.join('\n'))
  return 0
}

export const MUTATE_MODE: Mode = {
  name: 'mutate',
  summary: 'Create one movie, one episode and one video, then tear them down',
  usage: `${SCRIPT} mutate --repo-path <path> [--only movie|show|video] [--keep]`,
  flags: MUTATE_FLAGS,
  run: runMutate,
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.strings.get(name)
  return value === undefined || value.trim() === '' ? undefined : value.trim()
}

function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.booleans.has(name)
}

/** Usage errors exit 2, matching `verify-backend.ts`'s own convention. */
function reportUsage(error: unknown, mode: string): number {
  if (error instanceof MutateUsageError) {
    console.error(`${error.message}\n`)
    console.error(`Run \`${SCRIPT} ${mode} --help\` for the flags it takes.`)
    return 2
  }
  throw error
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

function unreachable(message: string): never {
  throw new Error(`Invariant violated: ${message}`)
}
