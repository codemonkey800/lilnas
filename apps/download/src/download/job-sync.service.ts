import {
  DOWNLOAD_JOB_EVENT_TYPE,
  type DownloadGatewayMessage,
  type DownloadJobEvent,
  DownloadJobEventType,
  DownloadType,
  MEDIA_EVENT_TYPE,
  type MediaEvent,
} from '@lilnas/utils/download/types'
import { Injectable, OnModuleInit } from '@nestjs/common'

import { AttributionResolutionService } from 'src/auth/attribution-resolution.service'
import { DbService } from 'src/db/db.service'
import { listJobsForSync, listOpenJobs } from 'src/db/jobs.repo'
import { DownloadGateway } from 'src/download-gateway/download.gateway'

import { projectJobForViewer } from './attribution'
import { DownloadStateService } from './download-state.service'

/**
 * The most jobs one catch-up carries. A tab asleep for days would otherwise
 * be sent every job written since; past this many, the newest writes win and
 * the page is due a reload anyway.
 */
export const MAX_SYNC_JOBS = 200

/**
 * Answers `SYNC_JOBS_EVENT` - a reconnecting socket's catch-up on what it
 * missed while it had none (a locked phone, a backgrounded tab, a backend
 * restart). Registered with the gateway at init rather than injected into it,
 * since this module already depends on the gateway's.
 */
@Injectable()
export class JobSyncService implements OnModuleInit {
  constructor(
    private readonly attributionResolutionService: AttributionResolutionService,
    private readonly dbService: DbService,
    private readonly downloadGateway: DownloadGateway,
    private readonly downloadStateService: DownloadStateService,
  ) {}

  onModuleInit(): void {
    this.downloadGateway.setSyncSource(since => this.buildSyncFrames(since))
  }

  /**
   * Every job still open, plus every job written at or after `since`, as the
   * same frames a live broadcast would have sent: a media frame ahead of each
   * video job (a video's state follows its job) and a job frame masked per
   * viewer. The Map's record wins over the row, as in `resolveJobRecord()`.
   */
  async buildSyncFrames(
    since: Date | undefined,
  ): Promise<(isAdmin: boolean) => DownloadGatewayMessage[]> {
    const { db } = this.dbService
    const rows = since
      ? listJobsForSync(db, since, MAX_SYNC_JOBS)
      : listOpenJobs(db).slice(0, MAX_SYNC_JOBS)

    const records = rows.flatMap(row => {
      const record = this.downloadStateService.resolveJobRecord(row.id)
      return record ? [record] : []
    })

    const jobs = await this.downloadStateService.hydrate(records)
    const resolved = await this.attributionResolutionService.resolveJobs(jobs)

    return isAdmin =>
      resolved.flatMap(job => {
        const jobFrame: DownloadGatewayMessage = {
          data: {
            job: projectJobForViewer(job, isAdmin),
            type: DownloadJobEventType.Updated,
          } satisfies DownloadJobEvent,
          type: DOWNLOAD_JOB_EVENT_TYPE,
        }

        if (job.media.type !== DownloadType.Video) return [jobFrame]

        const mediaFrame: DownloadGatewayMessage = {
          data: { media: job.media } satisfies MediaEvent,
          type: MEDIA_EVENT_TYPE,
        }
        return [mediaFrame, jobFrame]
      })
  }
}
