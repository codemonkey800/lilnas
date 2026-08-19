import {
  DOWNLOAD_JOB_EVENT_TYPE,
  DownloadJob,
  DownloadJobEvent,
  DownloadJobEventType,
  DownloadJobStatus,
  isVideoDownloadJob,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Queue } from '@lilnas/utils/queue'
import { Injectable, Logger } from '@nestjs/common'

import { DbService } from 'src/db/db.service'
import { buildJobRow, hydrateJobRow } from 'src/db/job-row'
import { getJobById } from 'src/db/jobs.repo'
import { jobs } from 'src/db/schema'
import { DownloadGateway } from 'src/download-gateway/download.gateway'

import { projectJobForViewer } from './attribution'

@Injectable()
export class DownloadStateService {
  private logger = new Logger(DownloadStateService.name)

  inProgressJobs = new Set<string>()
  jobs = new Map<string, DownloadJob>()
  queue = new Queue<string>()

  constructor(
    private readonly dbService: DbService,
    private readonly downloadGateway: DownloadGateway,
  ) {}

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
  addJob(job: DownloadJob): void {
    // Persist FIRST: on a write failure the caller gets an error and no
    // in-memory state exists at all, rather than an unqueued, unbroadcast
    // job stranded in the Map. buildJobRow() reads only `job`, never the
    // Map, so this reorder is behaviour-preserving on the success path.
    // Deliberately NOT caught: this call is request-scoped (the HTTP
    // handler that created the job is still on the stack), so a write
    // failure should surface to the caller rather than silently losing the
    // system of record. Contrast with updateJob() below.
    this.persistJob(job)
    this.jobs.set(job.id, job)
    this.broadcastJobEvent(job, DownloadJobEventType.Created)
  }

  /**
   * Resolves a job by id for the three detail routes
   * (`/videos/:id`, `/movies/:id`, `/shows/:id`), falling back to the
   * durable `jobs` row when the in-memory Map has no entry - the only way
   * those routes survive a restart, since the Map itself is emptied by
   * one. The Map always wins when it has an entry: it carries live,
   * in-flight fields (a video job's `proc` handle) the row can never
   * reconstruct, so a hit there must never be second-guessed by a DB read.
   */
  resolveJob(id: string): DownloadJob | undefined {
    const liveJob = this.jobs.get(id)
    if (liveJob) return liveJob

    const row = getJobById(this.dbService.db, id)
    return row ? hydrateJobRow(row) : undefined
  }

  updateJob(id: string, updates: Partial<DownloadJob>): DownloadJob {
    const action = 'updateJob'
    const job = this.jobs.get(id)

    if (!job) {
      this.logger.error(
        { action, jobId: id, totalJobs: this.jobs.size },
        'Job not found for update',
      )
      throw new Error(`Job with ID '${id}' not found`)
    }

    const sanitizedUrl = job.url.split('?')[0]
    const oldStatus = job.status
    const oldTitle = job.title
    const oldDescription = job.description
    const hasProcess = isVideoDownloadJob(job) && !!job.proc

    // Extract key fields from updates for logging
    const updateKeys = Object.keys(updates)
    const newStatus = updates.status
    const hasNewTitle = 'title' in updates
    const hasNewDescription = 'description' in updates
    const hasNewProcess = 'proc' in updates

    this.logger.log(
      {
        action,
        jobId: id,
        url: sanitizedUrl,
        updateKeys,
        statusTransition: newStatus
          ? `${oldStatus} -> ${newStatus}`
          : undefined,
        titleUpdate: hasNewTitle ? (oldTitle ? 'updated' : 'added') : undefined,
        descriptionUpdate: hasNewDescription
          ? oldDescription
            ? 'updated'
            : 'added'
          : undefined,
        processUpdate: hasNewProcess
          ? hasProcess
            ? 'updated'
            : 'added'
          : undefined,
      },
      'Updating job state',
    )

    const updatedJob: DownloadJob = {
      ...job,
      ...updates,
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
      updatedJob.completedAt = new Date()
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

    // Log the result based on what was changed
    if (newStatus && newStatus !== oldStatus) {
      this.logger.log(
        {
          action,
          jobId: id,
          url: sanitizedUrl,
          oldStatus,
          newStatus,
          totalJobs: this.jobs.size,
          queueSize: this.queue.size(),
          inProgressJobs: this.inProgressJobs.size,
        },
        'Job status updated',
      )
    }

    if (hasNewTitle || hasNewDescription) {
      this.logger.log(
        {
          action,
          jobId: id,
          url: sanitizedUrl,
          titleAdded: hasNewTitle && !oldTitle,
          descriptionAdded: hasNewDescription && !oldDescription,
        },
        'Job metadata updated',
      )
    }

    if (hasNewProcess) {
      this.logger.debug(
        {
          action,
          jobId: id,
          url: sanitizedUrl,
          processAdded: !!updates.proc,
          processRemoved: updates.proc === undefined,
        },
        'Job process reference updated',
      )
    }

    this.logger.debug(
      {
        action,
        jobId: id,
        url: sanitizedUrl,
        updateKeys,
        totalJobs: this.jobs.size,
      },
      'Job update completed',
    )

    this.broadcastJobEvent(updatedJob, DownloadJobEventType.Updated)

    return updatedJob
  }

  /**
   * Upserts `job` into the `jobs` table. better-sqlite3 is fully
   * synchronous, so this (and therefore addJob()/updateJob()) never needs
   * to be async. An upsert rather than a plain insert/update because
   * media/__tests__ seeds state via direct `jobs.set(...)` at several
   * sites, bypassing addJob() entirely - a plain `update` would throw on
   * those, and an upsert is idempotent against a Map entry whose row is
   * missing for any other reason too.
   */
  private persistJob(job: DownloadJob): void {
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
    } = buildJobRow(job)
    // Referenced only to satisfy no-unused-vars - see the destructure above.
    void _createdAt
    void _id

    this.dbService.db
      .insert(jobs)
      .values({ ...updatableColumns, id: job.id })
      .onConflictDoUpdate({ target: jobs.id, set: updatableColumns })
      .run()
  }

  private broadcastJobEvent(
    job: DownloadJob,
    type: DownloadJobEventType,
  ): void {
    // VideoDownloadJob.proc is a live ChildProcess handle - not JSON-safe
    // (circular references would throw inside JSON.stringify()) and not
    // meaningful to a WS subscriber anyway. Stripped the same way
    // getJobLogger() strips it before logging (download-video.service.ts):
    // setting it to `undefined` rather than deleting the key, since
    // JSON.stringify() omits `undefined`-valued properties entirely, and
    // this is a fresh shallow copy so the job actually stored in
    // `this.jobs` is untouched.
    const broadcastableJob = isVideoDownloadJob(job)
      ? { ...job, proc: undefined }
      : job

    // Two serializations at most (one per isAdmin value), not one per
    // client - see DownloadGateway.broadcastPerViewer(). This is the WS
    // half of the spec's attribution rule; DownloadController's REST
    // serializers apply the same projectJobForViewer() on the read path.
    // Not awaited: broadcastPerViewer() resolves each connected client's
    // admin status fresh (see DownloadGateway), but this is a
    // fire-and-forget broadcast, not a request the caller is waiting on.
    this.downloadGateway.broadcastPerViewer(isAdmin => {
      const event: DownloadJobEvent = {
        job: projectJobForViewer(broadcastableJob, isAdmin),
        type,
      }

      return { data: event, type: DOWNLOAD_JOB_EVENT_TYPE }
    })
  }
}
