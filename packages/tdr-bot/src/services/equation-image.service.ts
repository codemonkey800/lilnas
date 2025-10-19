import { env } from '@lilnas/utils/env'
import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { LRUCache } from 'lru-cache'
import { nanoid } from 'nanoid'
import { performance } from 'perf_hooks'
import { z } from 'zod'

import { EnvKeys } from 'src/env'
import {
  ErrorCategory,
  ErrorClassificationService,
} from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

const EquationAPISuccessSchema = z.object({
  bucket: z.string(),
  file: z.string(),
  url: z.string(),
})

type EquationAPISuccess = z.infer<typeof EquationAPISuccessSchema>

const EquationAPIFailureSchema = z.object({
  message: z.string(),
  status: z.number(),
})

const EquationAPIResponseSchema = z.union([
  EquationAPISuccessSchema,
  EquationAPIFailureSchema,
])

export interface EquationImageData extends EquationAPISuccess {
  url: string
}

@Injectable()
export class EquationImageService {
  private logger = new Logger(EquationImageService.name)

  private cache = new LRUCache<string, EquationImageData>({ max: 100 })

  // In-flight request cache to prevent duplicate requests
  private inFlightRequests = new Map<
    string,
    Promise<EquationAPISuccess | undefined>
  >()

  constructor(
    private readonly retryService: RetryService,
    private readonly errorClassifier: ErrorClassificationService,
  ) {}

  private async fetchImage(
    latex: string,
  ): Promise<EquationAPISuccess | undefined> {
    const id = nanoid()

    this.logger.log({ id }, 'Fetching latex image')
    const start = performance.now()

    try {
      const url = `${env(EnvKeys.EQUATIONS_URL)}/equations`

      const response = await this.retryService.executeWithCircuitBreaker(
        () =>
          axios.post(
            url,
            {
              latex,
              token: env(EnvKeys.EQUATIONS_API_KEY),
            },
            {
              timeout: 10000, // 10 second timeout
            },
          ),
        'equation-service',
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 10000,
        },
        `equation-service-${id}`,
      )

      const end = performance.now()
      const duration = end - start

      const data = EquationAPIResponseSchema.parse(response.data)

      if ('bucket' in data) {
        this.logger.log({ id, duration, ...data }, 'Fetched latex image')
        return data
      }

      this.logger.error(
        { id, duration, ...data },
        'Failed to fetch latex image',
      )
      return undefined
    } catch (error) {
      const end = performance.now()
      const duration = end - start

      const classification = this.errorClassifier.classifyError(
        error as Error,
        ErrorCategory.EQUATION_SERVICE,
      )

      this.logger.error(
        {
          id,
          duration,
          error: error instanceof Error ? error.message : 'Unknown error',
          errorType: classification.errorType,
          isRetryable: classification.isRetryable,
          category: classification.category,
          severity: classification.severity,
        },
        'Error fetching latex image',
      )

      return undefined
    }
  }

  async getImage(
    latex?: string | null | undefined,
  ): Promise<EquationImageData | undefined> {
    if (!latex) {
      return undefined
    }

    const id = nanoid()
    const normalizedLatex = latex.trim()

    // Check cache first
    const cachedValue = this.cache.get(normalizedLatex)
    if (cachedValue) {
      this.logger.log({ id, ...cachedValue }, 'Returning cached latex image')
      return cachedValue
    }

    // Check if request is already in flight to prevent duplicate requests
    const inFlightRequest = this.inFlightRequests.get(normalizedLatex)
    if (inFlightRequest) {
      this.logger.log(
        { id, latex: normalizedLatex },
        'Request already in flight, waiting for result',
      )
      const result = await inFlightRequest
      return result
    }

    // Create new request and add to in-flight cache
    const requestPromise = this.fetchImage(normalizedLatex)
    this.inFlightRequests.set(normalizedLatex, requestPromise)

    try {
      const image = await requestPromise

      if (image) {
        this.logger.log({ id, ...image }, 'Caching latex image')
        this.cache.set(normalizedLatex, image)
      }

      return image
    } finally {
      // Always remove from in-flight cache when done
      this.inFlightRequests.delete(normalizedLatex)
    }
  }
}
