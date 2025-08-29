import { Injectable } from '@nestjs/common'

import { ErrorSeverity } from 'src/utils/error-classifier'
import { RetryConfig } from 'src/utils/retry.service'

export interface ServiceRetryConfig {
  openai: RetryConfig
  discord: RetryConfig
  equationService: RetryConfig
  radarr: RetryConfig
  default: RetryConfig
}

export interface PartialServiceRetryConfig {
  openai?: Partial<RetryConfig>
  discord?: Partial<RetryConfig>
  equationService?: Partial<RetryConfig>
  radarr?: Partial<RetryConfig>
  default?: Partial<RetryConfig>
}

@Injectable()
export class RetryConfigService {
  private readonly configs: ServiceRetryConfig = {
    openai: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitter: true,
      timeout: 30000,
      logRetryAttempts: true,
      logSuccessfulRetries: true,
      logFailedRetries: true,
      logRetryDelays: false,
      logErrorDetails: true,
      logSeverityThreshold: ErrorSeverity.LOW,
    },
    discord: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 5000,
      backoffFactor: 2,
      jitter: true,
      timeout: 10000,
      logRetryAttempts: true,
      logSuccessfulRetries: true,
      logFailedRetries: true,
      logRetryDelays: false,
      logErrorDetails: true,
      logSeverityThreshold: ErrorSeverity.LOW,
    },
    equationService: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitter: true,
      timeout: 10000,
      logRetryAttempts: true,
      logSuccessfulRetries: true,
      logFailedRetries: true,
      logRetryDelays: false,
      logErrorDetails: true,
      logSeverityThreshold: ErrorSeverity.LOW,
    },
    radarr: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitter: true,
      timeout: 15000,
      logRetryAttempts: true,
      logSuccessfulRetries: true,
      logFailedRetries: true,
      logRetryDelays: false,
      logErrorDetails: true,
      logSeverityThreshold: ErrorSeverity.LOW,
    },
    default: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitter: true,
      timeout: 30000,
      logRetryAttempts: true,
      logSuccessfulRetries: true,
      logFailedRetries: true,
      logRetryDelays: false,
      logErrorDetails: true,
      logSeverityThreshold: ErrorSeverity.LOW,
    },
  }

  /**
   * Get retry configuration for OpenAI API calls
   */
  getOpenAIConfig(): RetryConfig {
    return { ...this.configs.openai }
  }

  /**
   * Get retry configuration for Discord API calls
   */
  getDiscordConfig(): RetryConfig {
    return { ...this.configs.discord }
  }

  /**
   * Get retry configuration for equation service calls
   */
  getEquationServiceConfig(): RetryConfig {
    return { ...this.configs.equationService }
  }

  /**
   * Get retry configuration for Radarr API calls
   */
  getRadarrConfig(): RetryConfig {
    return { ...this.configs.radarr }
  }

  /**
   * Get default retry configuration
   */
  getDefaultConfig(): RetryConfig {
    return { ...this.configs.default }
  }

  /**
   * Get retry configuration for a specific service
   */
  getConfigForService(service: keyof ServiceRetryConfig): RetryConfig {
    return { ...this.configs[service] }
  }

  /**
   * Update retry configuration for a specific service
   */
  updateConfig(
    service: keyof ServiceRetryConfig,
    config: Partial<RetryConfig>,
  ): void {
    this.configs[service] = { ...this.configs[service], ...config }
  }

  /**
   * Get all retry configurations
   */
  getAllConfigs(): ServiceRetryConfig {
    return {
      openai: { ...this.configs.openai },
      discord: { ...this.configs.discord },
      equationService: { ...this.configs.equationService },
      radarr: { ...this.configs.radarr },
      default: { ...this.configs.default },
    }
  }

  /**
   * Reset all configurations to defaults
   */
  resetToDefaults(): void {
    this.configs.openai = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitter: true,
      timeout: 30000,
      logRetryAttempts: true,
      logSuccessfulRetries: true,
      logFailedRetries: true,
      logRetryDelays: false,
      logErrorDetails: true,
      logSeverityThreshold: ErrorSeverity.LOW,
    }

    this.configs.discord = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 5000,
      backoffFactor: 2,
      jitter: true,
      timeout: 10000,
      logRetryAttempts: true,
      logSuccessfulRetries: true,
      logFailedRetries: true,
      logRetryDelays: false,
      logErrorDetails: true,
      logSeverityThreshold: ErrorSeverity.LOW,
    }

    this.configs.equationService = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitter: true,
      timeout: 10000,
      logRetryAttempts: true,
      logSuccessfulRetries: true,
      logFailedRetries: true,
      logRetryDelays: false,
      logErrorDetails: true,
      logSeverityThreshold: ErrorSeverity.LOW,
    }

    this.configs.radarr = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitter: true,
      timeout: 15000,
      logRetryAttempts: true,
      logSuccessfulRetries: true,
      logFailedRetries: true,
      logRetryDelays: false,
      logErrorDetails: true,
      logSeverityThreshold: ErrorSeverity.LOW,
    }

    this.configs.default = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitter: true,
      timeout: 30000,
      logRetryAttempts: true,
      logSuccessfulRetries: true,
      logFailedRetries: true,
      logRetryDelays: false,
      logErrorDetails: true,
      logSeverityThreshold: ErrorSeverity.LOW,
    }
  }
}

/**
 * Environment variable based configuration overrides
 */
export const getRetryConfigFromEnv = (): PartialServiceRetryConfig => {
  const envConfig: PartialServiceRetryConfig = {}

  // OpenAI configuration
  const openaiConfig: Partial<RetryConfig> = {}
  if (process.env.OPENAI_RETRY_MAX_ATTEMPTS) {
    openaiConfig.maxAttempts = parseInt(
      process.env.OPENAI_RETRY_MAX_ATTEMPTS,
      10,
    )
  }
  if (process.env.OPENAI_RETRY_BASE_DELAY) {
    openaiConfig.baseDelay = parseInt(process.env.OPENAI_RETRY_BASE_DELAY, 10)
  }
  if (process.env.OPENAI_RETRY_MAX_DELAY) {
    openaiConfig.maxDelay = parseInt(process.env.OPENAI_RETRY_MAX_DELAY, 10)
  }
  if (process.env.OPENAI_RETRY_TIMEOUT) {
    openaiConfig.timeout = parseInt(process.env.OPENAI_RETRY_TIMEOUT, 10)
  }
  if (process.env.OPENAI_RETRY_LOG_ATTEMPTS) {
    openaiConfig.logRetryAttempts =
      process.env.OPENAI_RETRY_LOG_ATTEMPTS === 'true'
  }
  if (process.env.OPENAI_RETRY_LOG_SUCCESS) {
    openaiConfig.logSuccessfulRetries =
      process.env.OPENAI_RETRY_LOG_SUCCESS === 'true'
  }
  if (process.env.OPENAI_RETRY_LOG_FAILED) {
    openaiConfig.logFailedRetries =
      process.env.OPENAI_RETRY_LOG_FAILED === 'true'
  }
  if (process.env.OPENAI_RETRY_LOG_DELAYS) {
    openaiConfig.logRetryDelays = process.env.OPENAI_RETRY_LOG_DELAYS === 'true'
  }
  if (process.env.OPENAI_RETRY_LOG_ERROR_DETAILS) {
    openaiConfig.logErrorDetails =
      process.env.OPENAI_RETRY_LOG_ERROR_DETAILS === 'true'
  }
  if (process.env.OPENAI_RETRY_LOG_SEVERITY_THRESHOLD) {
    openaiConfig.logSeverityThreshold = process.env
      .OPENAI_RETRY_LOG_SEVERITY_THRESHOLD as ErrorSeverity
  }
  if (Object.keys(openaiConfig).length > 0) {
    envConfig.openai = openaiConfig
  }

  // Discord configuration
  const discordConfig: Partial<RetryConfig> = {}
  if (process.env.DISCORD_RETRY_MAX_ATTEMPTS) {
    discordConfig.maxAttempts = parseInt(
      process.env.DISCORD_RETRY_MAX_ATTEMPTS,
      10,
    )
  }
  if (process.env.DISCORD_RETRY_BASE_DELAY) {
    discordConfig.baseDelay = parseInt(process.env.DISCORD_RETRY_BASE_DELAY, 10)
  }
  if (process.env.DISCORD_RETRY_MAX_DELAY) {
    discordConfig.maxDelay = parseInt(process.env.DISCORD_RETRY_MAX_DELAY, 10)
  }
  if (process.env.DISCORD_RETRY_TIMEOUT) {
    discordConfig.timeout = parseInt(process.env.DISCORD_RETRY_TIMEOUT, 10)
  }
  if (process.env.DISCORD_RETRY_LOG_ATTEMPTS) {
    discordConfig.logRetryAttempts =
      process.env.DISCORD_RETRY_LOG_ATTEMPTS === 'true'
  }
  if (process.env.DISCORD_RETRY_LOG_SUCCESS) {
    discordConfig.logSuccessfulRetries =
      process.env.DISCORD_RETRY_LOG_SUCCESS === 'true'
  }
  if (process.env.DISCORD_RETRY_LOG_FAILED) {
    discordConfig.logFailedRetries =
      process.env.DISCORD_RETRY_LOG_FAILED === 'true'
  }
  if (process.env.DISCORD_RETRY_LOG_DELAYS) {
    discordConfig.logRetryDelays =
      process.env.DISCORD_RETRY_LOG_DELAYS === 'true'
  }
  if (process.env.DISCORD_RETRY_LOG_ERROR_DETAILS) {
    discordConfig.logErrorDetails =
      process.env.DISCORD_RETRY_LOG_ERROR_DETAILS === 'true'
  }
  if (process.env.DISCORD_RETRY_LOG_SEVERITY_THRESHOLD) {
    discordConfig.logSeverityThreshold = process.env
      .DISCORD_RETRY_LOG_SEVERITY_THRESHOLD as ErrorSeverity
  }
  if (Object.keys(discordConfig).length > 0) {
    envConfig.discord = discordConfig
  }

  // Equation service configuration
  const equationServiceConfig: Partial<RetryConfig> = {}
  if (process.env.EQUATION_RETRY_MAX_ATTEMPTS) {
    equationServiceConfig.maxAttempts = parseInt(
      process.env.EQUATION_RETRY_MAX_ATTEMPTS,
      10,
    )
  }
  if (process.env.EQUATION_RETRY_BASE_DELAY) {
    equationServiceConfig.baseDelay = parseInt(
      process.env.EQUATION_RETRY_BASE_DELAY,
      10,
    )
  }
  if (process.env.EQUATION_RETRY_MAX_DELAY) {
    equationServiceConfig.maxDelay = parseInt(
      process.env.EQUATION_RETRY_MAX_DELAY,
      10,
    )
  }
  if (process.env.EQUATION_RETRY_TIMEOUT) {
    equationServiceConfig.timeout = parseInt(
      process.env.EQUATION_RETRY_TIMEOUT,
      10,
    )
  }
  if (process.env.EQUATION_RETRY_LOG_ATTEMPTS) {
    equationServiceConfig.logRetryAttempts =
      process.env.EQUATION_RETRY_LOG_ATTEMPTS === 'true'
  }
  if (process.env.EQUATION_RETRY_LOG_SUCCESS) {
    equationServiceConfig.logSuccessfulRetries =
      process.env.EQUATION_RETRY_LOG_SUCCESS === 'true'
  }
  if (process.env.EQUATION_RETRY_LOG_FAILED) {
    equationServiceConfig.logFailedRetries =
      process.env.EQUATION_RETRY_LOG_FAILED === 'true'
  }
  if (process.env.EQUATION_RETRY_LOG_DELAYS) {
    equationServiceConfig.logRetryDelays =
      process.env.EQUATION_RETRY_LOG_DELAYS === 'true'
  }
  if (process.env.EQUATION_RETRY_LOG_ERROR_DETAILS) {
    equationServiceConfig.logErrorDetails =
      process.env.EQUATION_RETRY_LOG_ERROR_DETAILS === 'true'
  }
  if (process.env.EQUATION_RETRY_LOG_SEVERITY_THRESHOLD) {
    equationServiceConfig.logSeverityThreshold = process.env
      .EQUATION_RETRY_LOG_SEVERITY_THRESHOLD as ErrorSeverity
  }
  if (Object.keys(equationServiceConfig).length > 0) {
    envConfig.equationService = equationServiceConfig
  }

  // Radarr configuration
  const radarrConfig: Partial<RetryConfig> = {}
  if (process.env.RADARR_RETRY_MAX_ATTEMPTS) {
    radarrConfig.maxAttempts = parseInt(
      process.env.RADARR_RETRY_MAX_ATTEMPTS,
      10,
    )
  }
  if (process.env.RADARR_RETRY_BASE_DELAY) {
    radarrConfig.baseDelay = parseInt(process.env.RADARR_RETRY_BASE_DELAY, 10)
  }
  if (process.env.RADARR_RETRY_MAX_DELAY) {
    radarrConfig.maxDelay = parseInt(process.env.RADARR_RETRY_MAX_DELAY, 10)
  }
  if (process.env.RADARR_RETRY_TIMEOUT) {
    radarrConfig.timeout = parseInt(process.env.RADARR_RETRY_TIMEOUT, 10)
  }
  if (process.env.RADARR_RETRY_LOG_ATTEMPTS) {
    radarrConfig.logRetryAttempts =
      process.env.RADARR_RETRY_LOG_ATTEMPTS === 'true'
  }
  if (process.env.RADARR_RETRY_LOG_SUCCESS) {
    radarrConfig.logSuccessfulRetries =
      process.env.RADARR_RETRY_LOG_SUCCESS === 'true'
  }
  if (process.env.RADARR_RETRY_LOG_FAILED) {
    radarrConfig.logFailedRetries =
      process.env.RADARR_RETRY_LOG_FAILED === 'true'
  }
  if (process.env.RADARR_RETRY_LOG_DELAYS) {
    radarrConfig.logRetryDelays = process.env.RADARR_RETRY_LOG_DELAYS === 'true'
  }
  if (process.env.RADARR_RETRY_LOG_ERROR_DETAILS) {
    radarrConfig.logErrorDetails =
      process.env.RADARR_RETRY_LOG_ERROR_DETAILS === 'true'
  }
  if (process.env.RADARR_RETRY_LOG_SEVERITY_THRESHOLD) {
    radarrConfig.logSeverityThreshold = process.env
      .RADARR_RETRY_LOG_SEVERITY_THRESHOLD as ErrorSeverity
  }
  if (Object.keys(radarrConfig).length > 0) {
    envConfig.radarr = radarrConfig
  }

  return envConfig
}
