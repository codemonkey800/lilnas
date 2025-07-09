import { Injectable } from '@nestjs/common'

import { RetryConfig } from 'src/utils/retry.service'

export interface ServiceRetryConfig {
  openai: RetryConfig
  discord: RetryConfig
  equationService: RetryConfig
  default: RetryConfig
}

export interface PartialServiceRetryConfig {
  openai?: Partial<RetryConfig>
  discord?: Partial<RetryConfig>
  equationService?: Partial<RetryConfig>
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
    },
    discord: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 5000,
      backoffFactor: 2,
      jitter: true,
      timeout: 10000,
    },
    equationService: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitter: true,
      timeout: 10000,
    },
    default: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitter: true,
      timeout: 30000,
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
    }

    this.configs.discord = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 5000,
      backoffFactor: 2,
      jitter: true,
      timeout: 10000,
    }

    this.configs.equationService = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitter: true,
      timeout: 10000,
    }

    this.configs.default = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitter: true,
      timeout: 30000,
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
  if (Object.keys(equationServiceConfig).length > 0) {
    envConfig.equationService = equationServiceConfig
  }

  return envConfig
}
