import { Injectable, Logger } from '@nestjs/common'

export interface RetryConfig {
  maxAttempts: number
  baseDelay: number
  maxDelay: number
  backoffFactor: number
  jitter: boolean
  timeout?: number
}

export interface RetryResult<T> {
  success: boolean
  data?: T
  error?: Error
  attempts: number
  totalTime: number
}

export interface CircuitBreakerState {
  failures: number
  lastFailureTime: number
  state: 'closed' | 'open' | 'half-open'
}

@Injectable()
export class RetryService {
  private readonly logger = new Logger(RetryService.name)
  private circuitBreakers = new Map<string, CircuitBreakerState>()

  private readonly defaultConfig: RetryConfig = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 60000,
    backoffFactor: 2,
    jitter: true,
    timeout: 30000,
  }

  /**
   * Execute an async operation with retry logic and exponential backoff
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    config: Partial<RetryConfig> = {},
    operationName = 'unknown',
  ): Promise<T> {
    const finalConfig = { ...this.defaultConfig, ...config }
    const startTime = Date.now()
    let lastError: Error = new Error('Unknown error')

    for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
      try {
        this.logger.debug(
          `Executing ${operationName} - attempt ${attempt}/${finalConfig.maxAttempts}`,
        )

        const result = await this.executeWithTimeout(
          operation,
          finalConfig.timeout,
        )

        if (attempt > 1) {
          this.logger.log(
            `${operationName} succeeded after ${attempt} attempts`,
          )
        }

        return result
      } catch (error) {
        lastError = error as Error

        this.logger.warn(
          `${operationName} failed on attempt ${attempt}/${finalConfig.maxAttempts}`,
          {
            error: lastError.message,
            attempt,
            operationName,
          },
        )

        // Don't wait after the last attempt
        if (attempt < finalConfig.maxAttempts) {
          const delay = this.calculateDelay(attempt - 1, finalConfig)
          await this.sleep(delay)
        }
      }
    }

    const totalTime = Date.now() - startTime
    this.logger.error(
      `${operationName} failed after ${finalConfig.maxAttempts} attempts in ${totalTime}ms`,
      {
        error: lastError.message,
        attempts: finalConfig.maxAttempts,
        totalTime,
        operationName,
      },
    )

    throw lastError
  }

  /**
   * Execute operation with circuit breaker pattern
   */
  async executeWithCircuitBreaker<T>(
    operation: () => Promise<T>,
    circuitBreakerKey: string,
    config: Partial<RetryConfig> = {},
    operationName = 'unknown',
  ): Promise<T> {
    const circuitState = this.getCircuitBreakerState(circuitBreakerKey)

    // Check if circuit is open
    if (circuitState.state === 'open') {
      const timeSinceLastFailure = Date.now() - circuitState.lastFailureTime
      const resetTimeout = 30000 // 30 seconds

      if (timeSinceLastFailure < resetTimeout) {
        throw new Error(
          `Circuit breaker is open for ${circuitBreakerKey}. Try again later.`,
        )
      }

      // Move to half-open state
      circuitState.state = 'half-open'
      this.logger.log(
        `Circuit breaker ${circuitBreakerKey} moved to half-open state`,
      )
    }

    try {
      const result = await this.executeWithRetry(
        operation,
        config,
        operationName,
      )

      // Success - reset circuit breaker
      if (circuitState.state === 'half-open') {
        circuitState.state = 'closed'
        circuitState.failures = 0
        this.logger.log(
          `Circuit breaker ${circuitBreakerKey} closed after successful operation`,
        )
      }

      return result
    } catch (error) {
      // Failure - update circuit breaker
      circuitState.failures++
      circuitState.lastFailureTime = Date.now()

      const failureThreshold = 5
      if (circuitState.failures >= failureThreshold) {
        circuitState.state = 'open'
        this.logger.warn(
          `Circuit breaker ${circuitBreakerKey} opened after ${circuitState.failures} failures`,
        )
      }

      throw error
    }
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

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeout}ms`))
      }, timeout)
    })

    return Promise.race([operation(), timeoutPromise])
  }

  /**
   * Get or create circuit breaker state
   */
  private getCircuitBreakerState(key: string): CircuitBreakerState {
    if (!this.circuitBreakers.has(key)) {
      this.circuitBreakers.set(key, {
        failures: 0,
        lastFailureTime: 0,
        state: 'closed',
      })
    }
    return this.circuitBreakers.get(key)!
  }

  /**
   * Reset circuit breaker state
   */
  resetCircuitBreaker(key: string): void {
    this.circuitBreakers.delete(key)
    this.logger.log(`Circuit breaker ${key} reset`)
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(key: string): CircuitBreakerState | undefined {
    return this.circuitBreakers.get(key)
  }
}
