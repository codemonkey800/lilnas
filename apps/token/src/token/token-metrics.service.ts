import { Injectable } from '@nestjs/common'
import { Counter, Gauge, Histogram, register } from 'prom-client'

type ValidationResult = 'valid' | 'invalid' | 'error'

const tokenValidationsTotal = new Counter({
  name: 'token_validations_total',
  help: 'Total number of token validation requests by app and result',
  labelNames: ['app_slug', 'result'],
  registers: [register],
})

const tokenValidationDurationSeconds = new Histogram({
  name: 'token_validation_duration_seconds',
  help: 'Duration of token validation operations including bcrypt comparison',
  labelNames: ['app_slug'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
})

const tokenCreationsTotal = new Counter({
  name: 'token_creations_total',
  help: 'Total number of API tokens created by app',
  labelNames: ['app_slug'],
  registers: [register],
})

const tokenDeletionsTotal = new Counter({
  name: 'token_deletions_total',
  help: 'Total number of API tokens revoked by app',
  labelNames: ['app_slug'],
  registers: [register],
})

const tokenActiveCount = new Gauge({
  name: 'token_active_count',
  help: 'Number of currently active API tokens per app',
  labelNames: ['app_slug'],
  registers: [register],
})

@Injectable()
export class TokenMetricsService {
  tokenValidated(appSlug: string, result: ValidationResult): void {
    tokenValidationsTotal.inc({ app_slug: appSlug, result })
  }

  observeValidationDuration(appSlug: string, durationMs: number): void {
    tokenValidationDurationSeconds.observe(
      { app_slug: appSlug },
      durationMs / 1000,
    )
  }

  tokenCreated(appSlug: string): void {
    tokenCreationsTotal.inc({ app_slug: appSlug })
    tokenActiveCount.inc({ app_slug: appSlug })
  }

  tokenDeleted(appSlug: string): void {
    tokenDeletionsTotal.inc({ app_slug: appSlug })
    tokenActiveCount.dec({ app_slug: appSlug })
  }
}
