import {
  DOWNLOAD_JOB_EVENT_TYPE,
  DownloadJob,
  DownloadJobEvent,
  DownloadJobEventType,
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadQueueSnapshot,
  DownloadType,
  isTerminalDownloadJobStatus,
  type Media,
  type TimeRange,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Queue } from '@lilnas/utils/queue'
import { Injectable, Logger } from '@nestjs/common'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { nanoid } from 'nanoid'

import { DbService } from 'src/db/db.service'
import { buildJobRow, hydrateJobRow } from 'src/db/job-row'
import { getJobById } from 'src/db/jobs.repo'
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

import { projectJobForViewer } from './attribution'

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
  // A movie/show job's last-known Radarr/Sonarr queue entry, keyed by job id
  // and never persisted - it's live upstream state, which is where it was
  // always coming from. MediaPollerService writes it; `hydrate()` below
  // grafts it onto the resolved Movie/Show on the way out.
  queueSnapshots = new Map<string, DownloadQueueSnapshot>()
  queue = new Queue<string>()

  constructor(
    private readonly dbService: DbService,
    private readonly downloadGateway: DownloadGateway,
    private readonly mediaResolverService: MediaResolverService,
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
   * Records the live queue snapshot for a movie/show job and re-broadcasts
   * it. Separate from `updateJob()` because a snapshot change is not a
   * change to the job row at all - nothing here is persisted - but
   * subscribers still need the progress tick.
   */
  setQueueSnapshot(id: string, snapshot: DownloadQueueSnapshot): void {
    this.queueSnapshots.set(id, snapshot)

    const record = this.jobs.get(id)
    if (record) {
      this.broadcastJobEvent(record, DownloadJobEventType.Updated)
    }
  }

  getQueueSnapshot(id: string): DownloadQueueSnapshot | undefined {
    return this.queueSnapshots.get(id)
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
   * values, then re-broadcasts the job so subscribers see the new title /
   * download URLs. The job row itself is untouched - none of this is job
   * state anymore.
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
    const base: Media = resolved ?? {
      id: recordMediaId,
      title: recordMediaId,
      ...(type === DownloadType.Movie
        ? { tmdbId: Number(mediaIdSuffix(recordMediaId)) || 1, type }
        : type === DownloadType.Show
          ? { tvdbId: Number(mediaIdSuffix(recordMediaId)) || 1, type }
          : { sourceUrl: '', type: DownloadType.Video }),
    }

    // The queue snapshot is per-*job* (two requests for the same movie have
    // independent progress) while everything else on `Media` is per-title,
    // so it's grafted on here rather than inside the resolver.
    const snapshot = this.queueSnapshots.get(record.id)
    const media =
      snapshot && base.type !== DownloadType.Video
        ? { ...base, queueSnapshot: snapshot }
        : base

    return { ...jobFields, media }
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
    // Completed - never cleared or re-derived on any other write, so a
    // later Completed -> Cancelled/Failed transition (e.g. a user deleting
    // an already-finished movie) doesn't wipe out when it actually
    // finished.
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
    // releases it without every call site having to remember to.
    if (newStatus && isTerminalDownloadJobStatus(newStatus)) {
      this.clearProc(id)
      this.queueSnapshots.delete(id)
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
      .then(([job]) => {
        if (!job) return

        // Two serializations at most (one per isAdmin value), not one per
        // client - see DownloadGateway.broadcastPerViewer(). This is the WS
        // half of the spec's attribution rule; DownloadController applies
        // the same projectJobForViewer() on the REST read path.
        return this.downloadGateway.broadcastPerViewer(isAdmin => {
          const event: DownloadJobEvent = {
            job: projectJobForViewer(job, isAdmin),
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
