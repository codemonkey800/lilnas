import { Injectable, Logger } from '@nestjs/common'
import {
  AxiosError,
  AxiosResponseHeaders,
  RawAxiosResponseHeaders,
} from 'axios'

export interface ErrorClassification {
  isRetryable: boolean
  errorType: ErrorType
  retryAfterMs?: number
  category: ErrorCategory
  severity: ErrorSeverity
}

export enum ErrorType {
  NETWORK_ERROR = 'network_error',
  RATE_LIMIT = 'rate_limit',
  TIMEOUT = 'timeout',
  SERVER_ERROR = 'server_error',
  CLIENT_ERROR = 'client_error',
  AUTHENTICATION_ERROR = 'authentication_error',
  PERMISSION_ERROR = 'permission_error',
  VALIDATION_ERROR = 'validation_error',
  UNKNOWN_ERROR = 'unknown_error',
}

export enum ErrorCategory {
  OPENAI_API = 'openai_api',
  DISCORD_API = 'discord_api',
  EQUATION_SERVICE = 'equation_service',
  HTTP_CLIENT = 'http_client',
  MEDIA_API = 'media_api',
  SYSTEM = 'system',
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

@Injectable()
export class ErrorClassificationService {
  private readonly logger = new Logger(ErrorClassificationService.name)

  /**
   * Classify an error to determine retry strategy
   */
  classifyError(error: Error, category: ErrorCategory): ErrorClassification {
    this.logger.debug(`Classifying error for category: ${category}`, {
      errorMessage: error.message,
      errorName: error.name,
      category,
    })

    switch (category) {
      case ErrorCategory.OPENAI_API:
        return this.classifyOpenAIError(error)
      case ErrorCategory.DISCORD_API:
        return this.classifyDiscordError(error)
      case ErrorCategory.EQUATION_SERVICE:
        return this.classifyEquationServiceError(error)
      case ErrorCategory.HTTP_CLIENT:
        return this.classifyHttpError(error)
      case ErrorCategory.MEDIA_API:
        return this.classifyMediaApiError(error)
      case ErrorCategory.SYSTEM:
        return this.classifySystemError(error)
      default:
        return this.getDefaultClassification(error)
    }
  }

  /**
   * Classify OpenAI API errors
   */
  private classifyOpenAIError(error: Error): ErrorClassification {
    const axiosError = error as AxiosError

    if (axiosError.response?.status) {
      const status = axiosError.response.status
      const retryAfter = this.parseRetryAfter(axiosError.response.headers)

      switch (status) {
        case 429: // Rate limit
          return {
            isRetryable: true,
            errorType: ErrorType.RATE_LIMIT,
            retryAfterMs: retryAfter,
            category: ErrorCategory.OPENAI_API,
            severity: ErrorSeverity.MEDIUM,
          }

        case 500: // Internal server error
        case 502: // Bad gateway
        case 503: // Service unavailable
        case 504: // Gateway timeout
          return {
            isRetryable: true,
            errorType: ErrorType.SERVER_ERROR,
            category: ErrorCategory.OPENAI_API,
            severity: ErrorSeverity.HIGH,
          }

        case 408: // Request timeout
          return {
            isRetryable: true,
            errorType: ErrorType.TIMEOUT,
            category: ErrorCategory.OPENAI_API,
            severity: ErrorSeverity.MEDIUM,
          }

        case 401: // Unauthorized
          return {
            isRetryable: false,
            errorType: ErrorType.AUTHENTICATION_ERROR,
            category: ErrorCategory.OPENAI_API,
            severity: ErrorSeverity.CRITICAL,
          }

        case 403: // Forbidden
          return {
            isRetryable: false,
            errorType: ErrorType.PERMISSION_ERROR,
            category: ErrorCategory.OPENAI_API,
            severity: ErrorSeverity.HIGH,
          }

        case 400: // Bad request
        case 404: // Not found
        case 422: // Unprocessable entity
          return {
            isRetryable: false,
            errorType: ErrorType.VALIDATION_ERROR,
            category: ErrorCategory.OPENAI_API,
            severity: ErrorSeverity.MEDIUM,
          }

        default:
          return {
            isRetryable: status >= 500,
            errorType:
              status >= 500 ? ErrorType.SERVER_ERROR : ErrorType.CLIENT_ERROR,
            category: ErrorCategory.OPENAI_API,
            severity: ErrorSeverity.MEDIUM,
          }
      }
    }

    // Network errors (no response)
    if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
      return {
        isRetryable: true,
        errorType: ErrorType.TIMEOUT,
        category: ErrorCategory.OPENAI_API,
        severity: ErrorSeverity.MEDIUM,
      }
    }

    if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
      return {
        isRetryable: true,
        errorType: ErrorType.NETWORK_ERROR,
        category: ErrorCategory.OPENAI_API,
        severity: ErrorSeverity.HIGH,
      }
    }

    return this.getDefaultClassification(error, ErrorCategory.OPENAI_API)
  }

  /**
   * Classify Discord API errors
   */
  private classifyDiscordError(error: Error): ErrorClassification {
    const axiosError = error as AxiosError

    if (axiosError.response?.status) {
      const status = axiosError.response.status
      const retryAfter = this.parseRetryAfter(axiosError.response.headers)

      switch (status) {
        case 429: // Rate limit
          return {
            isRetryable: true,
            errorType: ErrorType.RATE_LIMIT,
            retryAfterMs: retryAfter,
            category: ErrorCategory.DISCORD_API,
            severity: ErrorSeverity.MEDIUM,
          }

        case 500:
        case 502:
        case 503:
        case 504:
          return {
            isRetryable: true,
            errorType: ErrorType.SERVER_ERROR,
            category: ErrorCategory.DISCORD_API,
            severity: ErrorSeverity.HIGH,
          }

        case 401:
          return {
            isRetryable: false,
            errorType: ErrorType.AUTHENTICATION_ERROR,
            category: ErrorCategory.DISCORD_API,
            severity: ErrorSeverity.CRITICAL,
          }

        case 403:
          return {
            isRetryable: false,
            errorType: ErrorType.PERMISSION_ERROR,
            category: ErrorCategory.DISCORD_API,
            severity: ErrorSeverity.HIGH,
          }

        case 400:
        case 404:
          return {
            isRetryable: false,
            errorType: ErrorType.VALIDATION_ERROR,
            category: ErrorCategory.DISCORD_API,
            severity: ErrorSeverity.MEDIUM,
          }

        default:
          return {
            isRetryable: status >= 500,
            errorType:
              status >= 500 ? ErrorType.SERVER_ERROR : ErrorType.CLIENT_ERROR,
            category: ErrorCategory.DISCORD_API,
            severity: ErrorSeverity.MEDIUM,
          }
      }
    }

    return this.classifyNetworkError(error, ErrorCategory.DISCORD_API)
  }

  /**
   * Classify equation service errors
   */
  private classifyEquationServiceError(error: Error): ErrorClassification {
    const axiosError = error as AxiosError

    if (axiosError.response?.status) {
      const status = axiosError.response.status

      switch (status) {
        case 429:
          return {
            isRetryable: true,
            errorType: ErrorType.RATE_LIMIT,
            retryAfterMs: this.parseRetryAfter(axiosError.response.headers),
            category: ErrorCategory.EQUATION_SERVICE,
            severity: ErrorSeverity.MEDIUM,
          }

        case 500:
        case 502:
        case 503:
        case 504:
          return {
            isRetryable: true,
            errorType: ErrorType.SERVER_ERROR,
            category: ErrorCategory.EQUATION_SERVICE,
            severity: ErrorSeverity.HIGH,
          }

        case 408:
          return {
            isRetryable: true,
            errorType: ErrorType.TIMEOUT,
            category: ErrorCategory.EQUATION_SERVICE,
            severity: ErrorSeverity.MEDIUM,
          }

        case 400:
        case 422:
          return {
            isRetryable: false,
            errorType: ErrorType.VALIDATION_ERROR,
            category: ErrorCategory.EQUATION_SERVICE,
            severity: ErrorSeverity.LOW,
          }

        default:
          return {
            isRetryable: status >= 500,
            errorType:
              status >= 500 ? ErrorType.SERVER_ERROR : ErrorType.CLIENT_ERROR,
            category: ErrorCategory.EQUATION_SERVICE,
            severity: ErrorSeverity.MEDIUM,
          }
      }
    }

    return this.classifyNetworkError(error, ErrorCategory.EQUATION_SERVICE)
  }

  /**
   * Classify media API errors
   */
  private classifyMediaApiError(error: Error): ErrorClassification {
    const axiosError = error as AxiosError

    if (axiosError.response?.status) {
      const status = axiosError.response.status

      switch (status) {
        case 429: // Rate limit
          return {
            isRetryable: true,
            errorType: ErrorType.RATE_LIMIT,
            retryAfterMs: this.parseRetryAfter(axiosError.response.headers),
            category: ErrorCategory.MEDIA_API,
            severity: ErrorSeverity.MEDIUM,
          }

        case 500: // Internal server error
        case 502: // Bad gateway
        case 503: // Service unavailable
        case 504: // Gateway timeout
          return {
            isRetryable: true,
            errorType: ErrorType.SERVER_ERROR,
            category: ErrorCategory.MEDIA_API,
            severity: ErrorSeverity.HIGH,
          }

        case 408: // Request timeout
          return {
            isRetryable: true,
            errorType: ErrorType.TIMEOUT,
            category: ErrorCategory.MEDIA_API,
            severity: ErrorSeverity.MEDIUM,
          }

        case 401: // Unauthorized
          return {
            isRetryable: false,
            errorType: ErrorType.AUTHENTICATION_ERROR,
            category: ErrorCategory.MEDIA_API,
            severity: ErrorSeverity.CRITICAL,
          }

        case 403: // Forbidden
          return {
            isRetryable: false,
            errorType: ErrorType.PERMISSION_ERROR,
            category: ErrorCategory.MEDIA_API,
            severity: ErrorSeverity.HIGH,
          }

        case 400: // Bad request
        case 404: // Not found
        case 422: // Unprocessable entity
          return {
            isRetryable: false,
            errorType: ErrorType.VALIDATION_ERROR,
            category: ErrorCategory.MEDIA_API,
            severity: ErrorSeverity.MEDIUM,
          }

        default:
          return {
            isRetryable: status >= 500,
            errorType:
              status >= 500 ? ErrorType.SERVER_ERROR : ErrorType.CLIENT_ERROR,
            category: ErrorCategory.MEDIA_API,
            severity: ErrorSeverity.MEDIUM,
          }
      }
    }

    return this.classifyNetworkError(error, ErrorCategory.MEDIA_API)
  }

  /**
   * Classify HTTP client errors
   */
  private classifyHttpError(error: Error): ErrorClassification {
    const axiosError = error as AxiosError

    if (axiosError.response?.status) {
      const status = axiosError.response.status

      return {
        isRetryable: status >= 500 || status === 408 || status === 429,
        errorType: this.getErrorTypeFromStatus(status),
        retryAfterMs:
          status === 429
            ? this.parseRetryAfter(axiosError.response.headers)
            : undefined,
        category: ErrorCategory.HTTP_CLIENT,
        severity: status >= 500 ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM,
      }
    }

    return this.classifyNetworkError(error, ErrorCategory.HTTP_CLIENT)
  }

  /**
   * Classify system errors
   */
  private classifySystemError(error: Error): ErrorClassification {
    if (error.name === 'TimeoutError') {
      return {
        isRetryable: true,
        errorType: ErrorType.TIMEOUT,
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.MEDIUM,
      }
    }

    return {
      isRetryable: false,
      errorType: ErrorType.UNKNOWN_ERROR,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.HIGH,
    }
  }

  /**
   * Classify network errors
   */
  private classifyNetworkError(
    error: Error,
    category: ErrorCategory,
  ): ErrorClassification {
    const axiosError = error as AxiosError

    if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
      return {
        isRetryable: true,
        errorType: ErrorType.TIMEOUT,
        category,
        severity: ErrorSeverity.MEDIUM,
      }
    }

    if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
      return {
        isRetryable: true,
        errorType: ErrorType.NETWORK_ERROR,
        category,
        severity: ErrorSeverity.HIGH,
      }
    }

    return this.getDefaultClassification(error, category)
  }

  /**
   * Get error type from HTTP status code
   */
  private getErrorTypeFromStatus(status: number): ErrorType {
    if (status === 429) return ErrorType.RATE_LIMIT
    if (status === 408) return ErrorType.TIMEOUT
    if (status === 401) return ErrorType.AUTHENTICATION_ERROR
    if (status === 403) return ErrorType.PERMISSION_ERROR
    if (status >= 500) return ErrorType.SERVER_ERROR
    if (status >= 400) return ErrorType.CLIENT_ERROR
    return ErrorType.UNKNOWN_ERROR
  }

  /**
   * Parse retry-after header
   * Handles both AxiosResponseHeaders (axios 1.8.4+) and legacy Record<string, string | string[]> types
   */
  private parseRetryAfter(
    headers: RawAxiosResponseHeaders | AxiosResponseHeaders | undefined,
  ): number | undefined {
    if (!headers) return undefined

    // Handle AxiosResponseHeaders (axios 1.8.4+) - has .get() method
    if (
      typeof headers === 'object' &&
      'get' in headers &&
      typeof headers.get === 'function'
    ) {
      const axiosHeaders = headers as AxiosResponseHeaders
      // Try case-insensitive lookup using axios headers methods
      const retryAfter =
        axiosHeaders.get('retry-after') || axiosHeaders.get('Retry-After')
      if (retryAfter) {
        const retryAfterValue = Array.isArray(retryAfter)
          ? retryAfter[0]
          : retryAfter
        if (retryAfterValue) {
          const seconds = parseInt(String(retryAfterValue), 10)
          return isNaN(seconds) ? undefined : seconds * 1000
        }
      }
      return undefined
    }

    // Handle legacy Record<string, string | string[]> type (RawAxiosResponseHeaders)
    const rawHeaders = headers as Record<string, string | string[] | undefined>

    // Case-insensitive header lookup for backward compatibility
    const retryAfter =
      rawHeaders?.['retry-after'] ||
      rawHeaders?.['Retry-After'] ||
      rawHeaders?.['RETRY-AFTER'] ||
      // Also check for lowercase keys that might exist
      Object.keys(rawHeaders).find(key => key.toLowerCase() === 'retry-after')
        ? rawHeaders[
            Object.keys(rawHeaders).find(
              key => key.toLowerCase() === 'retry-after',
            )!
          ]
        : undefined

    if (!retryAfter) return undefined

    const retryAfterValue = Array.isArray(retryAfter)
      ? retryAfter[0]
      : retryAfter
    if (!retryAfterValue) return undefined

    const seconds = parseInt(String(retryAfterValue), 10)
    return isNaN(seconds) ? undefined : seconds * 1000
  }

  /**
   * Get default error classification
   */
  private getDefaultClassification(
    error: Error,
    category = ErrorCategory.SYSTEM,
  ): ErrorClassification {
    return {
      isRetryable: false,
      errorType: ErrorType.UNKNOWN_ERROR,
      category,
      severity: ErrorSeverity.MEDIUM,
    }
  }

  /**
   * Check if error should be retried based on classification
   */
  shouldRetry(error: Error, category: ErrorCategory): boolean {
    const classification = this.classifyError(error, category)
    return classification.isRetryable
  }

  /**
   * Get retry delay based on error classification
   */
  getRetryDelay(error: Error, category: ErrorCategory): number | undefined {
    const classification = this.classifyError(error, category)
    return classification.retryAfterMs
  }
}
