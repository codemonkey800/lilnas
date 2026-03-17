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
