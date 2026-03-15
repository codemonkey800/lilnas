import { Logger } from '@nestjs/common'
import { ZodSchema } from 'zod'

import { MediaApiError } from 'src/media/errors/media-api.error'
import { errorMessage } from 'src/media/utils/media.utils'
import { ErrorCategory } from 'src/utils/error-classifier'
import { RetryConfig, RetryService } from 'src/utils/retry.service'

/**
 * Abstract base class for Radarr and Sonarr services.
 * Provides shared validation helpers and a retry wrapper for SDK calls.
 */
export abstract class BaseMediaService {
  protected abstract readonly logger: Logger
  protected abstract readonly serviceName: string
  protected abstract readonly retryService: RetryService
  protected abstract readonly circuitBreakerKey: string
  protected abstract readonly retryConfig: RetryConfig

  /**
   * Executes a @lilnas/media SDK call wrapped in RetryService circuit breaker.
   *
   * The SDK returns `{ data, error, response }`. If `error` is set, we throw a
   * MediaApiError carrying `response.status` so ErrorClassificationService can
   * classify the failure the same way it classified Axios errors.
   */
  protected async executeWithRetry<T>(
    operation: () => Promise<{
      data?: T
      error?: unknown
      response?: Response
    }>,
    operationName: string,
  ): Promise<T> {
    return this.retryService.executeWithCircuitBreaker(
      async () => {
        const result = await operation()
        if (result.error != null) {
          const status = result.response?.status ?? 500
          throw new MediaApiError(
            status,
            result.error,
            result.response?.headers,
          )
        }
        // Only guard against missing data for responses that are expected to
        // carry a body (2xx with content). DELETE / void endpoints correctly
        // return status 204 with no data, and test mocks for void calls omit
        // the response object entirely.
        const status = result.response?.status
        const isContentResponse =
          status != null && status !== 204 && status >= 200 && status < 300
        if (result.data == null && isContentResponse) {
          throw new MediaApiError(
            status,
            'SDK returned no data and no error',
            result.response?.headers,
          )
        }
        return result.data as T
      },
      this.circuitBreakerKey,
      this.retryConfig,
      operationName,
      ErrorCategory.MEDIA_API,
    )
  }

  /**
   * Validates a required search query input against a Zod schema.
   * Throws a descriptive error if validation fails.
   */
  protected validateSearchQuery<T>(
    input: { query: string },
    schema: ZodSchema<T>,
  ): T {
    try {
      return schema.parse(input)
    } catch (error) {
      const msg = errorMessage(error, 'Unknown validation error')
      this.logger.error({ input, error: msg }, 'Invalid search query input')
      throw new Error(`Invalid search query: ${msg}`)
    }
  }

  /**
   * Validates an optional search query input against a Zod schema.
   * Throws a descriptive error if validation fails.
   */
  protected validateOptionalSearchQuery<T>(
    input: { query?: string },
    schema: ZodSchema<T>,
  ): T {
    try {
      return schema.parse(input)
    } catch (error) {
      const msg = errorMessage(error, 'Unknown validation error')
      this.logger.error(
        { input, error: msg },
        'Invalid optional search query input',
      )
      throw new Error(`Invalid search query: ${msg}`)
    }
  }
}
