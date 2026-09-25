import {
  DOWNLOAD_JOB_EVENT_TYPE,
  DownloadJob,
  DownloadJobEvent,
  DownloadJobEventType,
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  isTerminalDownloadJobStatus,
  type Media,
  MEDIA_EVENT_TYPE,
  type MediaEvent,
  type TimeRange,
  type VideoProgress,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Queue } from '@lilnas/utils/queue'
import { Injectable, Logger } from '@nestjs/common'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { nanoid } from 'nanoid'

import { AttributionResolutionService } from 'src/auth/attribution-resolution.service'
import { DbService } from 'src/db/db.service'
import { buildJobRow, hydrateJobRow } from 'src/db/job-row'
import { getJobById, listJobsByStatus, listOpenJobs } from 'src/db/jobs.repo'
import { mediaIdSuffix, videoNaturalKey } from 'src/db/media-id'
import { jobs, type VideoRow } from 'src/db/schema'
import {
  getVideoById,
  updateVideoById,
  type UpdateVideoPatch,
  upsertVideoByNaturalKey,
} from 'src/db/videos.repo'
import { DownloadGateway } from 'src/download-gateway/download.gateway'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { MediaStateService } from 'src/media/media-state.service'

import { projectJobForViewer } from './attribution'
import { JobInterruptKind } from './job-interrupted.error'

/**
 * The most often a video job's progress ticks are re-broadcast. yt-dlp
 * reports several times a second; a page only needs to see the bar move.
 */
export const PROGRESS_BROADCAST_INTERVAL_MS = 1_000

export interface EnsureVideoInput {
  downloadUrls?: string[]
  overview?: string
  sourceUrl: string
  timeRange?: TimeRange
  title?: string
}

@Injectable()
export class DownloadStateService {
  private logger = new Logger(DownloadStateService.name)

  inProgressJobs = new Set<string>()
  // The durable, media-free half of a job. `media` is derived on read via
  // MediaResolverService rather than cached here - a per-job copy would just
  // be a second cache with its own staleness.
  jobs = new Map<string, DownloadJobRecord>()
  // A video job's live `ChildProcess` handle, tracked out-of-band from the
  // job object itself - not JSON-safe (circular refs would throw inside
  // JSON.stringify()) and not meaningful to a WS subscriber, so it never
  // belongs on a broadcast/persisted job.
  procs = new Map<string, ChildProcessWithoutNullStreams>()
  // Why a job's process is *about* to be killed, recorded by the caller just
  // before it calls `proc.kill()`. A SIGTERM'd yt-dlp is indistinguishable
  // from a crashed one by exit code alone, so without this note the pipeline
  // would report every deliberate stop as a failure - and pause and cancel
  // are the same kill, differing only in the status the job should land in.
  // Never persisted: it describes a process that is alive right now, and a
  // restart kills that process anyway, so a surviving entry could only ever
  // be a lie about a job the new process never started.
  interruptions = new Map<string, JobInterruptKind>()
  queue = new Queue<string>()

  /**
   * Process-lifetime, like `procs`: the latest yt-dlp tick per video job.
   * Never persisted - `reconcileInterruptedJobs()` fails every open video row
   * at boot, so a stored snapshot could only ever describe a dead download,
   * and `updateJob()` upserts the row on every call, so a write per tick
   * would be pure write amplification. `toJob()` attaches it on every read.
   */
  private readonly progress = new Map<string, VideoProgress>()
  /** The trailing send armed for a tick that landed inside the window. */
  private readonly progressTimers = new Map<string, NodeJS.Timeout>()
  /** When each job's progress was last re-broadcast (`Date.now()`). */
  private readonly progressSentAt = new Map<string, number>()

  constructor(
    private readonly attributionResolutionService: AttributionResolutionService,
    private readonly dbService: DbService,
    private readonly downloadGateway: DownloadGateway,
    private readonly mediaResolverService: MediaResolverService,
    private readonly mediaStateService: MediaStateService,
  ) {}

  setProc(id: string, proc: ChildProcessWithoutNullStreams): void {
    this.procs.set(id, proc)
  }

  getProc(id: string): ChildProcessWithoutNullStreams | undefined {
    return this.procs.get(id)
  }

  clearProc(id: string): void {
    this.procs.delete(id)
  }

  /**
   * Notes that the next process exit for `id` is deliberate, and what it
   * meant. Deliberately unvalidated: recording an intent for a job with no
   * tracked proc is legal (the caller is the one that knows whether a kill is
   * actually going to happen), and re-recording is last-write-wins - a cancel
   * arriving on the heels of a pause is exactly the case that has to win.
   */
  setInterruption(id: string, kind: JobInterruptKind): void {
    this.interruptions.set(id, kind)
  }

  getInterruption(id: string): JobInterruptKind | undefined {
    return this.interruptions.get(id)
  }

  clearInterruption(id: string): void {
    this.interruptions.delete(id)
  }

  /**
   * Re-broadcasts a job as `Updated` without changing or persisting
   * anything. For a change that lives on the job's media rather than its
   * row - a movie/show's queue progress, which `MediaStateService` holds and
   * the broadcast's hydrate reads - so subscribers still get the tick. An id
   * the Map doesn't hold is a no-op.
   */
  touchJob(id: string): void {
    const record = this.jobs.get(id)
    if (record) {
      this.broadcastJobEvent(record, DownloadJobEventType.Updated)
    }
  }

  /**
   * Stores a video job's latest progress snapshot and re-broadcasts the job,
   * throttled to one frame per `PROGRESS_BROADCAST_INTERVAL_MS`. A tick
   * inside the window only replaces the stored snapshot and arms (at most)
   * one trailing send, which carries whatever snapshot is current when it
   * fires - so a burst of ticks costs one frame, and the last tick is never
   * lost. `flush` sends now regardless and restarts the window. Nothing is
   * persisted (see `progress`). An id the Map doesn't hold is a no-op, same
   * rule as `touchJob()`.
   */
  setProgress(
    id: string,
    snapshot: VideoProgress,
    options?: { flush?: boolean },
  ): void {
    if (!this.jobs.has(id)) return

    this.progress.set(id, snapshot)

    const sentAt = this.progressSentAt.get(id)
    const elapsed = sentAt === undefined ? Infinity : Date.now() - sentAt

    if (options?.flush || elapsed >= PROGRESS_BROADCAST_INTERVAL_MS) {
      this.sendProgress(id)
      return
    }

    if (!this.progressTimers.has(id)) {
      const timer = setTimeout(
        () => this.sendProgress(id),
        PROGRESS_BROADCAST_INTERVAL_MS - elapsed,
      )
      // A pending send must never keep the process (or a jest worker) alive.
      timer.unref()
      this.progressTimers.set(id, timer)
    }
  }

  /**
   * Sends any snapshot a trailing timer is holding, now - for the pipeline
   * to call once the process closes, so the final tick doesn't wait out the
   * window. A no-op when nothing is pending.
   */
  flushProgress(id: string): void {
    if (this.progressTimers.has(id)) {
      this.sendProgress(id)
    }
  }

  getProgress(id: string): VideoProgress | undefined {
    return this.progress.get(id)
  }

  /** Cancels any pending send, restarts the window and re-broadcasts. */
  private sendProgress(id: string): void {
    this.clearProgressTimer(id)
    this.progressSentAt.set(id, Date.now())
    this.touchJob(id)
  }

  private clearProgressTimer(id: string): void {
    const timer = this.progressTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.progressTimers.delete(id)
    }
  }

  /** Drops everything the progress throttle holds for `id`. */
  private clearProgress(id: string): void {
    this.clearProgressTimer(id)
    this.progress.delete(id)
    this.progressSentAt.delete(id)
  }

  /**
   * Upserts a `videos` row for a video's identifying fields - the only
   * writer of the `videos` table (plan §4.2), called once per video job at
   * creation to mint the `video:<id>` key. Idempotent on
   * `(sourceUrl, timeRange)` via `videos_natural_key_idx`, so requesting the
   * same clip twice yields two jobs pointing at one row.
   */
  ensureVideo(input: EnsureVideoInput): VideoRow {
    return upsertVideoByNaturalKey(this.dbService.db, {
      downloadUrls: input.downloadUrls,
      id: nanoid(),
      naturalKey: videoNaturalKey({
        sourceUrl: input.sourceUrl,
        timeRange: input.timeRange,
      }),
      overview: input.overview,
      sourceUrl: input.sourceUrl,
      timeRange: input.timeRange,
      // NOT NULL, so it's seeded from the source URL and overwritten by
      // `updateVideo()` the moment yt-dlp reports the real one - no UI
      // surface needs a `?? sourceUrl` fallback.
      title: input.title ?? input.sourceUrl,
    })
  }

  /** The `videos` row behind a `video:<id>` key, or `undefined`. */
  getVideo(videoMediaId: string): VideoRow | undefined {
    return getVideoById(this.dbService.db, mediaIdSuffix(videoMediaId))
  }

  requireVideo(videoMediaId: string): VideoRow {
    const row = this.getVideo(videoMediaId)
    if (!row) {
      throw new Error(`No videos row for media id '${videoMediaId}'`)
    }

    return row
  }

  /**
   * Patches the `videos` row a job points at as the pipeline learns real
   * values, then re-broadcasts the job - and, the job being a video's, the
   * video's media event - so subscribers see the new title / download URLs.
   * The job row itself is untouched - none of this is job state anymore.
   */
  updateVideo(id: string, patch: UpdateVideoPatch): void {
    const record = this.jobs.get(id)
    if (!record) {
      throw new Error(`Job with ID '${id}' not found`)
    }

    updateVideoById(this.dbService.db, mediaIdSuffix(record.mediaId), patch)
    this.broadcastJobEvent(record, DownloadJobEventType.Updated)
  }

  /**
   * Inserts a brand-new job and broadcasts its creation. Job creation never
   * goes through `updateJob()` below (there's no existing job in the map to
   * update yet), so without this, a freshly-created job would stay
   * invisible to other connected clients until its first status change -
   * this is the only place that closes that gap. Every direct-insert call
   * site (`DownloadSchedulerService.add()`, `MediaDownloadService`'s
   * requestMovie/requestShow) must go through this method instead of
   * touching `jobs.set()` itself.
   */
  addJob(record: DownloadJobRecord): void {
    // Persist FIRST: on a write failure the caller gets an error and no
    // in-memory state exists at all, rather than an unqueued, unbroadcast
    // job stranded in the Map. buildJobRow() reads only `record`, never the
    // Map, so this reorder is behaviour-preserving on the success path.
    // Deliberately NOT caught: this call is request-scoped (the HTTP
    // handler that created the job is still on the stack), so a write
    // failure should surface to the caller rather than silently losing the
    // system of record. Contrast with updateJob() below.
    this.persistJob(record)
    this.jobs.set(record.id, record)
    this.trackVideoActivity(record)
    this.broadcastJobEvent(record, DownloadJobEventType.Created)
  }

  /**
   * Resolves a job *record* by id, falling back to the durable `jobs` row
   * when the in-memory Map has no entry - the only way the detail routes
   * survive a restart, since the Map itself is emptied by one. The Map
   * always wins when it has an entry: a restart also empties `procs` (see
   * `setProc()`), so there is nothing left to reconstruct either way, but
   * the Map may still carry other in-flight state the row can't - a hit
   * there must never be second-guessed by a DB read.
   */
  resolveJobRecord(id: string): DownloadJobRecord | undefined {
    const liveJob = this.jobs.get(id)
    if (liveJob) return liveJob

    const row = getJobById(this.dbService.db, id)
    return row ? hydrateJobRow(row) : undefined
  }

  /**
   * `resolveJobRecord()`, but the resolved record is also put *into* the Map
   * so `updateJob()`/`updateVideo()` can act on it.
   *
   * `updateJob()` throws for a job the Map has never seen, which is correct
   * for its usual callers (a background pipeline step acting on a job that
   * vanished is a bug worth an error). The delete paths are the exception:
   * a restart empties the Map, but the `jobs` row and the MinIO objects it
   * points at both outlive it, and "the process forgot about it" must not be
   * the reason a user can't clean it up. Adopting the row first means the
   * update, the persist and the `Updated` broadcast all behave exactly as
   * they would for a job that never left.
   */
  adoptJob(id: string): DownloadJobRecord | undefined {
    const record = this.resolveJobRecord(id)

    if (record && !this.jobs.has(id)) {
      this.jobs.set(id, record)
    }

    return record
  }

  /**
   * Boot: puts every job a restart leaves open back in the Map so the poller
   * sees it. Returns the count.
   *
   * That is every non-terminal movie/show row, plus every `needs_attention`
   * row of any type - exactly the rows `reconcileInterruptedJobs()` spares.
   * A movie/show attempt's truth lives in Radarr/Sonarr, which outlived this
   * process, so the download carries on across the restart; failing it
   * would be wrong (the file can still land), and sparing the row is only
   * half the job - the Map is what `MediaPollerService` iterates, and a
   * restart empties it, so an unadopted row would sit at its last status
   * forever with nothing watching it. Once adopted, the poller settles it
   * from the queue and the files on its next tick.
   *
   * No `Updated` broadcast: this runs before `app.listen()`, so there is no
   * WS subscriber to tell, and nothing about the record changed anyway.
   */
  adoptOpenJobs(): number {
    const { db } = this.dbService
    const rows = [
      ...listOpenJobs(db, [DownloadType.Movie, DownloadType.Show]),
      // Movie/show `needs_attention` rows are already in the list above.
      ...listJobsByStatus(db, DownloadJobStatus.NeedsAttention).filter(
        row => row.type === DownloadType.Video,
      ),
    ]

    let adopted = 0
    for (const row of rows) {
      if (this.adoptJob(row.id)) adopted++
    }

    this.logger.log(`Adopted ${adopted} open job(s) at boot`)

    return adopted
  }

  /** `resolveJobRecord()` with its `media` resolved - the wire shape. */
  async resolveJob(id: string): Promise<DownloadJob | undefined> {
    const record = this.resolveJobRecord(id)
    return record ? this.hydrateOne(record) : undefined
  }

  /**
   * `hydrate()` for a single record. `hydrate()` never drops a record (an
   * unresolvable key degrades to a placeholder), so the empty case here is
   * unreachable - it exists only to satisfy `noUncheckedIndexedAccess`
   * without an assertion that would hide a real regression.
   */
  async hydrateOne(record: DownloadJobRecord): Promise<DownloadJob> {
    const [job] = await this.hydrate([record])
    if (!job) {
      throw new Error(`Failed to hydrate job '${record.id}'`)
    }

    return job
  }

  /**
   * Joins a batch of records to their `Media` in one resolver call - one
   * upstream Radarr/Sonarr round trip per page rather than per job (plan
   * §4.1). Records whose media can't be resolved still come back, carrying
   * the resolver's degraded placeholder, so a list endpoint never drops a
   * job it knows about just because Radarr is down.
   */
  async hydrate(records: readonly DownloadJobRecord[]): Promise<DownloadJob[]> {
    if (records.length === 0) return []

    const { media } = await this.mediaResolverService.resolve(
      records.map(record => ({
        mediaId: record.mediaId,
        type: record.type,
      })),
    )

    return records.map(record => this.toJob(record, media.get(record.mediaId)))
  }

  private toJob(
    record: DownloadJobRecord,
    resolved: Media | undefined,
  ): DownloadJob {
    const { mediaId: recordMediaId, type, ...jobFields } = record
    // No per-job graft: a movie/show's `queueSnapshot` is the resolver's,
    // derived from the queue cache on every resolve(), so it is as fresh as
    // the last poll and there is only one place it can come from.
    const media: Media = resolved ?? {
      id: recordMediaId,
      title: recordMediaId,
      ...(type === DownloadType.Movie
        ? { tmdbId: Number(mediaIdSuffix(recordMediaId)) || 1, type }
        : type === DownloadType.Show
          ? { tvdbId: Number(mediaIdSuffix(recordMediaId)) || 1, type }
          : { sourceUrl: '', type: DownloadType.Video }),
    }

    // Absent rather than `undefined` when there's no snapshot, so a
    // serialised frame (and a test fixture) for a job with no progress is
    // unchanged. Only a live video job in this process ever has one.
    const progress = this.progress.get(record.id)

    return { ...jobFields, media, ...(progress ? { progress } : {}) }
  }

  updateJob(
    id: string,
    updates: Partial<Omit<DownloadJobRecord, 'id' | 'mediaId' | 'type'>>,
  ): DownloadJobRecord {
    const action = 'updateJob'
    const record = this.jobs.get(id)

    if (!record) {
      this.logger.error(
        { action, jobId: id, totalJobs: this.jobs.size },
        'Job not found for update',
      )
      throw new Error(`Job with ID '${id}' not found`)
    }

    const oldStatus = record.status
    const updateKeys = Object.keys(updates)
    const newStatus = updates.status

    const updatedJob: DownloadJobRecord = {
      ...record,
      ...updates,
      updatedAt: new Date().toISOString(),
    }

    // Stamp the completion time exactly once, on the transition into
    // Completed - never cleared or re-derived on any other write, so no
    // later update to the row can move when it actually finished.
    if (
      updates.status === DownloadJobStatus.Completed &&
      oldStatus !== DownloadJobStatus.Completed
    ) {
      updatedJob.completedAt = new Date().toISOString()
    }

    // The process handle (tracked in `procs`, not on the job itself - see
    // `setProc()`) has nothing left to reference once a job reaches a
    // terminal status; clearing it here means every terminal transition
    // (Cancelled from a user action, Completed/Failed from the pipeline)
    // releases it without every call site having to remember to. The
    // interrupt intent goes with it: it only ever describes the *next* exit
    // of a live process, so once the job is terminal a leftover entry could
    // only mislead a future read. So does the progress snapshot, along with
    // any trailing send it armed - no frame from here on (this transition's
    // own included) carries a bar for a download that is over. A
    // non-terminal stop (Paused) keeps it on purpose: the bar stays where
    // the download stopped.
    if (newStatus && isTerminalDownloadJobStatus(newStatus)) {
      this.clearProc(id)
      this.clearInterruption(id)
      this.clearProgress(id)
    }

    this.jobs.set(id, updatedJob)

    // Unlike addJob(), the callers here are background pipeline steps
    // (download-video.service.ts, download-scheduler.service.ts, a
    // deferred proc.on('close') handler firing after the HTTP response is
    // already sent) - none of them have a request to fail. The in-memory
    // Map, not this row, is the live source of truth for a running job, so
    // a persistence failure is logged and swallowed rather than aborting
    // an in-flight download over a bookkeeping failure.
    try {
      this.persistJob(updatedJob)
    } catch (err) {
      this.logger.error(
        { action, jobId: id, error: getErrorMessage(err) },
        'Failed to persist job update; continuing with in-memory state only',
      )
    }

    if (newStatus && newStatus !== oldStatus) {
      this.logger.log(
        {
          action,
          jobId: id,
          mediaId: record.mediaId,
          oldStatus,
          newStatus,
          totalJobs: this.jobs.size,
          queueSize: this.queue.size(),
          inProgressJobs: this.inProgressJobs.size,
        },
        'Job status updated',
      )
    }

    this.logger.debug(
      {
        action,
        jobId: id,
        mediaId: record.mediaId,
        updateKeys,
        totalJobs: this.jobs.size,
      },
      'Job update completed',
    )

    this.trackVideoActivity(updatedJob)
    this.broadcastJobEvent(updatedJob, DownloadJobEventType.Updated)

    return updatedJob
  }

  /**
   * Upserts `record` into the `jobs` table. better-sqlite3 is fully
   * synchronous, so this (and therefore addJob()/updateJob()) never needs
   * to be async. An upsert rather than a plain insert/update because
   * media/__tests__ seeds state via direct `jobs.set(...)` at several
   * sites, bypassing addJob() entirely - a plain `update` would throw on
   * those, and an upsert is idempotent against a Map entry whose row is
   * missing for any other reason too.
   */
  private persistJob(record: DownloadJobRecord): void {
    // `id` is the conflict target and `createdAt` must never be overwritten
    // on update — named explicitly here so both exclusions stay visible,
    // while every other column is carried across automatically. This makes
    // omitting a future column from the update set structurally
    // impossible, which matters more than the (harmless) alternative
    // mistake of including one - `tsc` can't catch an omission here since
    // drizzle's update `set:` type makes every key optional.
    const {
      createdAt: _createdAt,
      id: _id,
      ...updatableColumns
    } = buildJobRow(record)
    // Referenced only to satisfy no-unused-vars - see the destructure above.
    void _createdAt
    void _id

    this.dbService.db
      .insert(jobs)
      .values(buildJobRow(record))
      .onConflictDoUpdate({ target: jobs.id, set: updatableColumns })
      .run()
  }

  /**
   * Plan 021. Feeds a video job's status to `MediaStateService`, which is
   * what a video's `state` is derived from - `addJob()` and `updateJob()`
   * are the only places a job's status changes, so calling this from both
   * keeps the activity map exact. A terminal status clears the entry.
   * Called before the job is broadcast, so the resolver's annotate - which
   * the broadcast's hydrate runs - already sees the new status.
   *
   * Movie/show jobs are skipped: their state comes from the Radarr/Sonarr
   * queues the poller feeds, not from the job.
   */
  private trackVideoActivity(record: DownloadJobRecord): void {
    if (record.type !== DownloadType.Video) return

    this.mediaStateService.setVideoActivity(
      record.mediaId,
      isTerminalDownloadJobStatus(record.status) ? undefined : record.status,
    )
  }

  /**
   * Plan 021. Sends a media snapshot to every client. Unlike a job event it
   * carries no requester, so it goes out as one frame for every viewer
   * rather than through `broadcastPerViewer()`.
   */
  private broadcastMediaEvent(media: Media): void {
    const event = { media } satisfies MediaEvent
    this.downloadGateway.broadcast({ data: event, type: MEDIA_EVENT_TYPE })
  }

  /**
   * Resolves the record's media and broadcasts it. Fire-and-forget: the
   * callers are HTTP handlers and background pipeline steps that must not
   * block on (or fail because of) a Radarr lookup, and the resolver never
   * throws - it degrades to a placeholder - so the only thing that can go
   * wrong here is the broadcast itself.
   */
  private broadcastJobEvent(
    record: DownloadJobRecord,
    type: DownloadJobEventType,
  ): void {
    void this.hydrate([record])
      .then(async ([job]) => {
        if (!job) return

        // A video's state follows its job (see trackVideoActivity()), so
        // every video job event is also a media event - sent from the media
        // this hydrate already resolved and annotated, rather than resolving
        // it a second time. Sent ahead of the attribution lookup below so a
        // failure there can't swallow it. Movies and shows are the poller's
        // to broadcast: their state moves with the upstream queue, not here.
        if (job.media.type === DownloadType.Video) {
          this.broadcastMediaEvent(job.media)
        }

        // Link resolution runs **once**, here, outside broadcastPerViewer() -
        // that callback fires once per distinct isAdmin value, and resolving
        // inside it would double the lookups for an answer that does not
        // depend on the viewer at all. It also has to come before the mask,
        // which nulls the fields resolution fills.
        const [resolved] = await this.attributionResolutionService.resolveJobs([
          job,
        ])

        // Two serializations at most (one per isAdmin value), not one per
        // client - see DownloadGateway.broadcastPerViewer(). This is the WS
        // half of the spec's attribution rule; DownloadController applies
        // the same projectJobForViewer() on the REST read path.
        return this.downloadGateway.broadcastPerViewer(isAdmin => {
          const event: DownloadJobEvent = {
            job: projectJobForViewer(resolved ?? job, isAdmin),
            type,
          }

          return { data: event, type: DOWNLOAD_JOB_EVENT_TYPE }
        })
      })
      .catch((err: unknown) => {
        this.logger.error(
          {
            action: 'broadcastJobEvent',
            jobId: record.id,
            error: getErrorMessage(err),
          },
          'Failed to broadcast job event',
        )
      })
  }
}
