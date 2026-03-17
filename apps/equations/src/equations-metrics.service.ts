import { Injectable } from '@nestjs/common'
import { Counter, Gauge, Histogram, register } from 'prom-client'

type CompilationStatus = 'success' | 'failed'
type ValidationFailureReason = 'schema' | 'safety' | 'auth'
type UploadStatus = 'success' | 'failed'
type CompilationPhase = 'pdflatex' | 'imagemagick' | 'upload' | 'total'

const compilationsTotal = new Counter({
  name: 'equations_compilations_total',
  help: 'Total number of equation compilations by status',
  labelNames: ['status'],
  registers: [register],
})

const validationFailuresTotal = new Counter({
  name: 'equations_validation_failures_total',
  help: 'Total number of input validation failures by reason',
  labelNames: ['reason'],
  registers: [register],
})

const rateLimitedTotal = new Counter({
  name: 'equations_rate_limited_total',
  help: 'Total number of requests rejected due to concurrent job limit',
  registers: [register],
})

const minioUploadsTotal = new Counter({
  name: 'equations_minio_uploads_total',
  help: 'Total number of MinIO upload attempts by status',
  labelNames: ['status'],
  registers: [register],
})

const compilationDurationSeconds = new Histogram({
  name: 'equations_compilation_duration_seconds',
  help: 'Duration of each phase in the equation compilation pipeline',
  labelNames: ['phase'],
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 15, 20, 30, 60],
  registers: [register],
})

const latexInputLength = new Histogram({
  name: 'equations_latex_input_length',
  help: 'Distribution of LaTeX input string lengths in bytes',
  buckets: [50, 100, 250, 500, 1000, 2000, 3000, 5000],
  registers: [register],
})

const activeJobs = new Gauge({
  name: 'equations_active_jobs',
  help: 'Number of equation compilations currently in progress',
  registers: [register],
})

@Injectable()
export class EquationsMetricsService {
  compilationCompleted(status: CompilationStatus): void {
    compilationsTotal.inc({ status })
  }

  validationFailure(reason: ValidationFailureReason): void {
    validationFailuresTotal.inc({ reason })
  }

  rateLimited(): void {
    rateLimitedTotal.inc()
  }

  minioUpload(status: UploadStatus): void {
    minioUploadsTotal.inc({ status })
  }

  observePhase(phase: CompilationPhase, durationMs: number): void {
    compilationDurationSeconds.observe({ phase }, durationMs / 1000)
  }

  observeLatexLength(length: number): void {
    latexInputLength.observe(length)
  }

  setActiveJobs(count: number): void {
    activeJobs.set(count)
  }
}
