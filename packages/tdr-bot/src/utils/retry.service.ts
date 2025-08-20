import { Injectable, Logger } from '@nestjs/common'

import {
  createOperationName,
  isOperationName,
  OperationName,
} from 'src/types/branded'

import {
  ErrorCategory,
  ErrorClassificationService,
  ErrorSeverity,
} from './error-classifier'

export interface RetryConfig {
  maxAttempts: number
  baseDelay: number
  maxDelay: number
  backoffFactor: number
  jitter: boolean
  timeout?: number
  logRetryAttempts?: boolean
  logSuccessfulRetries?: boolean
  logFailedRetries?: boolean
  logRetryDelays?: boolean
  logErrorDetails?: boolean
  logSeverityThreshold?: ErrorSeverity
}

export interface RetryResult<T> {
  success: boolean
  data?: T
  error?: Error
  attempts: number
  totalTime: number
}

/**
 * Type constraint for operations that can be retried
 */
export type RetryableOperation<T> = () => Promise<T>

/**
 * Base interface for operations that provide context
 */
export interface OperationContext {
  operationName: OperationName
  category: ErrorCategory
  metadata?: Record<string, unknown>
}

/**
 * Enhanced retry result with context
 */
export interface RetryResultWithContext<T> extends RetryResult<T> {
  context: OperationContext
}

@Injectable()
export class RetryService {
  private readonly logger = new Logger(RetryService.name)

  constructor(private readonly errorClassifier: ErrorClassificationService) {}

  private readonly defaultConfig: RetryConfig = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 60000,
    backoffFactor: 2,
    jitter: true,
    timeout: 30000,
    logRetryAttempts: true,
    logSuccessfulRetries: true,
    logFailedRetries: true,
    logRetryDelays: true,
    logErrorDetails: true,
    logSeverityThreshold: ErrorSeverity.LOW,
  }

  /**
   * Execute an async operation with retry logic and exponential backoff
   * @template T - The return type of the operation
   * @param operation - The async operation to execute with retry
   * @param config - Partial retry configuration to override defaults
   * @param operationName - Branded operation name for logging and identification
   * @param errorCategory - Category for error classification
   * @returns Promise that resolves to the operation result
   */
  async executeWithRetry<T>(
    operation: RetryableOperation<T>,
    config: Partial<RetryConfig> = {},
    operationName: OperationName | string = 'unknown',
    errorCategory: ErrorCategory = ErrorCategory.SYSTEM,
  ): Promise<T> {
    // Ensure operationName is branded
    const brandedOperationName = isOperationName(operationName)
      ? operationName
      : createOperationName(operationName as string)
    const finalConfig = { ...this.defaultConfig, ...config }
    const startTime = Date.now()
    let lastError: Error = new Error('Unknown error')

    for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
      try {
        if (finalConfig.logRetryAttempts) {
          this.logger.debug(
            `Executing ${brandedOperationName} - attempt ${attempt}/${finalConfig.maxAttempts}`,
            {
              operationName: brandedOperationName,
              attempt,
              maxAttempts: finalConfig.maxAttempts,
              category: errorCategory,
            },
          )
        }

        const result = await this.executeWithTimeout(
          operation,
          finalConfig.timeout,
        )

        if (attempt > 1 && finalConfig.logSuccessfulRetries) {
          const totalTime = Date.now() - startTime
          this.logger.log(
            `${brandedOperationName} succeeded after ${attempt} attempts in ${totalTime}ms`,
            {
              operationName: brandedOperationName,
              attempt,
              totalTime,
              category: errorCategory,
            },
          )
        }

        return result
      } catch (error) {
        lastError = error as Error

        const classification = this.errorClassifier.classifyError(
          lastError,
          errorCategory,
        )

        const shouldLogError =
          finalConfig.logRetryAttempts &&
          this.shouldLogBasedOnSeverity(
            classification.severity,
            finalConfig.logSeverityThreshold,
          )

        if (shouldLogError) {
          const logData = {
            operationName: brandedOperationName,
            attempt,
            maxAttempts: finalConfig.maxAttempts,
            category: errorCategory,
            errorType: classification.errorType,
            errorCategory: classification.category,
            severity: classification.severity,
            isRetryable: classification.isRetryable,
            retryAfterMs: classification.retryAfterMs,
            ...(finalConfig.logErrorDetails && {
              errorMessage: lastError.message,
              errorStack: lastError.stack,
              errorName: lastError.name,
            }),
          }

          this.logger.warn(
            `${brandedOperationName} failed on attempt ${attempt}/${finalConfig.maxAttempts}`,
            logData,
          )
        }

        // Don't wait after the last attempt
        if (attempt < finalConfig.maxAttempts) {
          const delay = this.calculateDelay(attempt - 1, finalConfig)

          if (finalConfig.logRetryDelays) {
            this.logger.debug(
              `Waiting ${delay}ms before retry attempt ${attempt + 1}`,
              {
                operationName: brandedOperationName,
                nextAttempt: attempt + 1,
                delay,
                category: errorCategory,
              },
            )
          }

          await this.sleep(delay)
        }
      }
    }

    const totalTime = Date.now() - startTime

    if (finalConfig.logFailedRetries) {
      const classification = this.errorClassifier.classifyError(
        lastError,
        errorCategory,
      )

      const logData = {
        operationName: brandedOperationName,
        attempts: finalConfig.maxAttempts,
        totalTime,
        category: errorCategory,
        errorType: classification.errorType,
        errorCategory: classification.category,
        severity: classification.severity,
        isRetryable: classification.isRetryable,
        retryAfterMs: classification.retryAfterMs,
        ...(finalConfig.logErrorDetails && {
          errorMessage: lastError.message,
          errorStack: lastError.stack,
          errorName: lastError.name,
        }),
      }

      this.logger.error(
        `${brandedOperationName} failed after ${finalConfig.maxAttempts} attempts in ${totalTime}ms`,
        logData,
      )
    }

    throw lastError
  }

  /**
   * Check if error should be logged based on severity threshold
   */
  private shouldLogBasedOnSeverity(
    errorSeverity: ErrorSeverity,
    threshold?: ErrorSeverity,
  ): boolean {
    if (!threshold) {
      return true
    }

    const severityOrder = {
      [ErrorSeverity.LOW]: 0,
      [ErrorSeverity.MEDIUM]: 1,
      [ErrorSeverity.HIGH]: 2,
      [ErrorSeverity.CRITICAL]: 3,
    }

    return severityOrder[errorSeverity] >= severityOrder[threshold]
  }

  /**
   * Calculate delay with exponential backoff and optional jitter
   */
  private calculateDelay(attempt: number, config: RetryConfig): number {
    const exponentialDelay = Math.min(
      config.maxDelay,
      config.baseDelay * Math.pow(config.backoffFactor, attempt),
    )

    if (!config.jitter) {
      return exponentialDelay
    }

    // Full jitter: randomize between 0 and calculated delay
    return Math.random() * exponentialDelay
  }

  /**
   * Sleep for specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeout?: number,
  ): Promise<T> {
    if (!timeout) {
      return operation()
    }

    let timeoutHandle: NodeJS.Timeout | null = null

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeout}ms`))
      }, timeout)
    })

    try {
      const result = await Promise.race([operation(), timeoutPromise])
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      return result
    } catch (error) {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      throw error
    }
  }
}
