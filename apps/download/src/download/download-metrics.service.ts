import type { DownloadType } from '@lilnas/utils/download/types'
import { Injectable } from '@nestjs/common'
import { Counter, Gauge, Histogram, register } from 'prom-client'

type JobCompletedStatus = 'completed' | 'failed' | 'cancelled'
type JobPhase = 'download' | 'convert' | 'upload' | 'clean' | 'total'
type VideoInfoResult = 'success' | 'timeout' | 'error'
type YtdlpUpdateResult = 'success' | 'failure' | 'rollback'

function extractSourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'unknown'
  }
}

const jobsCreatedTotal = new Counter({
  name: 'download_jobs_created_total',
  help: 'Total number of download jobs created',
  labelNames: ['source'],
  registers: [register],
})

const jobsCompletedTotal = new Counter({
  name: 'download_jobs_completed_total',
  help: 'Total number of download jobs that reached a terminal state',
  labelNames: ['status'],
  registers: [register],
})

// Deliberately *not* a `download_jobs_completed_total{status="paused"}`
// label: a pause is not a terminal state (see DownloadJobStatus.Paused), and
// folding it into the completed counter would make
// `sum(download_jobs_completed_total)` stop meaning "jobs that finished".
// Paused/resumed as their own pair also makes the obvious dashboard query -
// paused minus resumed - the count of jobs currently parked.
const jobsPausedTotal = new Counter({
  name: 'download_jobs_paused_total',
  help: 'Total number of download jobs paused by a user',
  registers: [register],
})

const jobsResumedTotal = new Counter({
  name: 'download_jobs_resumed_total',
  help: 'Total number of paused download jobs put back on the queue',
  registers: [register],
})

// Saving a file to a device is not a download *job* - nothing is queued and
// no row is written - so it gets its own counter rather than another
// `download_jobs_*` label. `type` is `DownloadType`'s own values ('movie' /
// 'show' / 'video'), which keeps this joinable against
// `download_jobs_created_total` without a translation table.
//
// Counted at stream *start*, not completion: the bytes leave over minutes
// and the client can abandon the transfer at any point, so "saves started"
// is the only figure a single request can honestly report.
const mediaFileSavesTotal = new Counter({
  name: 'download_media_file_saves_total',
  help: 'Total number of media files streamed to a client to save locally',
  labelNames: ['type'],
  registers: [register],
})

const jobsInProgress = new Gauge({
  name: 'download_jobs_in_progress',
  help: 'Number of download jobs currently being processed',
  registers: [register],
})

const jobsQueued = new Gauge({
  name: 'download_jobs_queued',
  help: 'Number of download jobs waiting in the queue',
  registers: [register],
})

const jobPhaseDurationSeconds = new Histogram({
  name: 'download_job_phase_duration_seconds',
  help: 'Duration of each phase in the download pipeline',
  labelNames: ['phase'],
  buckets: [1, 5, 15, 30, 60, 120, 300, 600],
  registers: [register],
})

const videoInfoDurationSeconds = new Histogram({
  name: 'download_video_info_duration_seconds',
  help: 'Duration of yt-dlp video metadata extraction',
  labelNames: ['result'],
  buckets: [0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register],
})

const ytdlpUpdatesTotal = new Counter({
  name: 'download_ytdlp_updates_total',
  help: 'Total number of yt-dlp update attempts by result',
  labelNames: ['result'],
  registers: [register],
})

@Injectable()
export class DownloadMetricsService {
  jobCreated(url: string): void {
    const source = extractSourceDomain(url)
    jobsCreatedTotal.inc({ source })
  }

  jobCompleted(status: JobCompletedStatus): void {
    jobsCompletedTotal.inc({ status })
  }

  jobPaused(): void {
    jobsPausedTotal.inc()
  }

  jobResumed(): void {
    jobsResumedTotal.inc()
  }

  fileSaved(type: DownloadType): void {
    mediaFileSavesTotal.inc({ type })
  }

  setInProgress(count: number): void {
    jobsInProgress.set(count)
  }

  setQueueDepth(count: number): void {
    jobsQueued.set(count)
  }

  observePhase(phase: JobPhase, durationMs: number): void {
    jobPhaseDurationSeconds.observe({ phase }, durationMs / 1000)
  }

  observeVideoInfo(result: VideoInfoResult, durationMs: number): void {
    videoInfoDurationSeconds.observe({ result }, durationMs / 1000)
  }

  ytdlpUpdate(result: YtdlpUpdateResult): void {
    ytdlpUpdatesTotal.inc({ result })
  }
}
