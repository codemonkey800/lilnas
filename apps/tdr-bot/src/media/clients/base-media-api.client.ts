import { Logger } from '@nestjs/common'
import axios, { AxiosError, AxiosRequestConfig } from 'axios'
import { nanoid } from 'nanoid'
import { performance } from 'perf_hooks'

import {
  ErrorCategory,
  ErrorClassificationService,
} from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

export abstract class BaseMediaApiClient {
  protected readonly logger: Logger
  protected abstract readonly serviceName: string
  protected abstract readonly baseUrl: string
  protected abstract readonly apiKey: string
  protected abstract readonly circuitBreakerKey: string

  constructor(
    protected readonly retryService: RetryService,
    protected readonly errorClassifier: ErrorClassificationService,
  ) {
    this.logger = new Logger(this.constructor.name)
  }

  /**
   * Create axios config with API key authentication
   */
  protected createAxiosConfig(config?: AxiosRequestConfig): AxiosRequestConfig {
    const headers = {
      'X-Api-Key': this.apiKey,
      'Content-Type': 'application/json',
      ...config?.headers,
    }

    return {
      timeout: 15000,
      ...config,
      headers,
      baseURL: this.baseUrl,
    }
  }

  /**
   * Execute HTTP GET request with retry logic
   */
  protected async get<T>(
    endpoint: string,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const id = nanoid()

    this.logger.log(
      { id, endpoint, method: 'GET' },
      `${this.serviceName} GET request`,
    )
    const start = performance.now()

    try {
      const axiosConfig = this.createAxiosConfig(config)

      const response = await this.retryService.executeWithCircuitBreaker(
        () => axios.get<T>(endpoint, axiosConfig),
        this.circuitBreakerKey,
        this.getRetryConfig(),
        `${this.serviceName}-get-${id}`,
      )

      const duration = performance.now() - start
      this.logger.log(
        { id, endpoint, method: 'GET', status: response.status, duration },
        `${this.serviceName} GET success`,
      )

      return response.data
    } catch (error) {
      const duration = performance.now() - start
      const classification = this.errorClassifier.classifyError(
        error as Error,
        this.getErrorCategory(),
      )

      this.logger.error(
        {
          id,
          endpoint,
          method: 'GET',
          duration,
          error: error instanceof Error ? error.message : 'Unknown error',
          errorType: classification.errorType,
          isRetryable: classification.isRetryable,
          category: classification.category,
          severity: classification.severity,
          status: (error as AxiosError)?.response?.status,
        },
        `${this.serviceName} GET error`,
      )

      throw error
    }
  }

  /**
   * Execute HTTP POST request with retry logic
   */
  protected async post<T>(
    endpoint: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const id = nanoid()

    this.logger.log(
      { id, endpoint, method: 'POST' },
      `${this.serviceName} POST request`,
    )
    const start = performance.now()

    try {
      const axiosConfig = this.createAxiosConfig(config)

      const response = await this.retryService.executeWithCircuitBreaker(
        () => axios.post<T>(endpoint, data, axiosConfig),
        this.circuitBreakerKey,
        this.getRetryConfig(),
        `${this.serviceName}-post-${id}`,
      )

      const duration = performance.now() - start
      this.logger.log(
        { id, endpoint, method: 'POST', status: response.status, duration },
        `${this.serviceName} POST success`,
      )

      return response.data
    } catch (error) {
      const duration = performance.now() - start
      const classification = this.errorClassifier.classifyError(
        error as Error,
        this.getErrorCategory(),
      )

      this.logger.error(
        {
          id,
          endpoint,
          method: 'POST',
          duration,
          error: error instanceof Error ? error.message : 'Unknown error',
          errorType: classification.errorType,
          isRetryable: classification.isRetryable,
          category: classification.category,
          severity: classification.severity,
          status: (error as AxiosError)?.response?.status,
        },
        `${this.serviceName} POST error`,
      )

      throw error
    }
  }

  /**
   * Execute HTTP PUT request with retry logic
   */
  protected async put<T>(
    endpoint: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const id = nanoid()

    this.logger.log(
      { id, endpoint, method: 'PUT' },
      `${this.serviceName} PUT request`,
    )
    const start = performance.now()

    try {
      const axiosConfig = this.createAxiosConfig(config)

      const response = await this.retryService.executeWithCircuitBreaker(
        () => axios.put<T>(endpoint, data, axiosConfig),
        this.circuitBreakerKey,
        this.getRetryConfig(),
        `${this.serviceName}-put-${id}`,
      )

      const duration = performance.now() - start
      this.logger.log(
        { id, endpoint, method: 'PUT', status: response.status, duration },
        `${this.serviceName} PUT success`,
      )

      return response.data
    } catch (error) {
      const duration = performance.now() - start
      const classification = this.errorClassifier.classifyError(
        error as Error,
        this.getErrorCategory(),
      )

      this.logger.error(
        {
          id,
          endpoint,
          method: 'PUT',
          duration,
          error: error instanceof Error ? error.message : 'Unknown error',
          errorType: classification.errorType,
          isRetryable: classification.isRetryable,
          category: classification.category,
          severity: classification.severity,
          status: (error as AxiosError)?.response?.status,
        },
        `${this.serviceName} PUT error`,
      )

      throw error
    }
  }

  /**
   * Execute HTTP DELETE request with retry logic
   */
  protected async delete<T>(
    endpoint: string,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const id = nanoid()

    this.logger.log(
      { id, endpoint, method: 'DELETE' },
      `${this.serviceName} DELETE request`,
    )
    const start = performance.now()

    try {
      const axiosConfig = this.createAxiosConfig(config)

      const response = await this.retryService.executeWithCircuitBreaker(
        () => axios.delete<T>(endpoint, axiosConfig),
        this.circuitBreakerKey,
        this.getRetryConfig(),
        `${this.serviceName}-delete-${id}`,
      )

      const duration = performance.now() - start
      this.logger.log(
        { id, endpoint, method: 'DELETE', status: response.status, duration },
        `${this.serviceName} DELETE success`,
      )

      return response.data
    } catch (error) {
      const duration = performance.now() - start
      const classification = this.errorClassifier.classifyError(
        error as Error,
        this.getErrorCategory(),
      )

      this.logger.error(
        {
          id,
          endpoint,
          method: 'DELETE',
          duration,
          error: error instanceof Error ? error.message : 'Unknown error',
          errorType: classification.errorType,
          isRetryable: classification.isRetryable,
          category: classification.category,
          severity: classification.severity,
          status: (error as AxiosError)?.response?.status,
        },
        `${this.serviceName} DELETE error`,
      )

      throw error
    }
  }

  /**
   * Get error category for this media API client
   */
  protected getErrorCategory(): ErrorCategory {
    return ErrorCategory.MEDIA_API
  }

  /**
   * Get retry configuration - subclasses can override for custom config
   */
  protected abstract getRetryConfig(): {
    maxAttempts: number
    baseDelay: number
    maxDelay: number
    timeout?: number
  }

  /**
   * Health check for the API
   */
  abstract checkHealth(): Promise<boolean>
}
