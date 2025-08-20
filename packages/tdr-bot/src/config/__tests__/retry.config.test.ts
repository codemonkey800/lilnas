import { Test, TestingModule } from '@nestjs/testing'

import {
  getRetryConfigFromEnv,
  RetryConfigService,
} from 'src/config/retry.config'

describe('RetryConfigService', () => {
  let service: RetryConfigService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RetryConfigService],
    }).compile()

    service = module.get<RetryConfigService>(RetryConfigService)
  })

  describe('getOpenAIConfig', () => {
    it('should return OpenAI retry configuration', () => {
      const config = service.getOpenAIConfig()

      expect(config).toEqual({
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
        logSeverityThreshold: 'low',
      })
    })

    it('should return a copy of the configuration', () => {
      const config1 = service.getOpenAIConfig()
      const config2 = service.getOpenAIConfig()

      expect(config1).not.toBe(config2) // Different objects
      expect(config1).toEqual(config2) // Same values
    })
  })

  describe('getDiscordConfig', () => {
    it('should return Discord retry configuration', () => {
      const config = service.getDiscordConfig()

      expect(config).toEqual({
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
        logSeverityThreshold: 'low',
      })
    })
  })

  describe('getEquationServiceConfig', () => {
    it('should return equation service retry configuration', () => {
      const config = service.getEquationServiceConfig()

      expect(config).toEqual({
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
        logSeverityThreshold: 'low',
      })
    })
  })

  describe('media service configurations', () => {
    it('should return Sonarr retry configuration', () => {
      const config = service.getSonarrConfig()

      expect(config).toEqual({
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 15000,
        backoffFactor: 2,
        jitter: true,
        timeout: 15000,
        logRetryAttempts: true,
        logSuccessfulRetries: true,
        logFailedRetries: true,
        logRetryDelays: false,
        logErrorDetails: true,
        logSeverityThreshold: 'low',
      })
    })

    it('should return Radarr retry configuration', () => {
      const config = service.getRadarrConfig()

      expect(config).toEqual({
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 15000,
        backoffFactor: 2,
        jitter: true,
        timeout: 15000,
        logRetryAttempts: true,
        logSuccessfulRetries: true,
        logFailedRetries: true,
        logRetryDelays: false,
        logErrorDetails: true,
        logSeverityThreshold: 'low',
      })
    })

    it('should return Emby retry configuration', () => {
      const config = service.getEmbyConfig()

      expect(config).toEqual({
        maxAttempts: 2,
        baseDelay: 500,
        maxDelay: 5000,
        backoffFactor: 2,
        jitter: true,
        timeout: 10000,
        logRetryAttempts: true,
        logSuccessfulRetries: true,
        logFailedRetries: true,
        logRetryDelays: false,
        logErrorDetails: true,
        logSeverityThreshold: 'low',
      })
    })
  })

  describe('getDefaultConfig', () => {
    it('should return default retry configuration', () => {
      const config = service.getDefaultConfig()

      expect(config).toEqual({
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
        logSeverityThreshold: 'low',
      })
    })
  })

  describe('getConfigForService', () => {
    it('should return configuration for specified service', () => {
      const openaiConfig = service.getConfigForService('openai')
      const discordConfig = service.getConfigForService('discord')

      expect(openaiConfig.timeout).toBe(30000)
      expect(discordConfig.timeout).toBe(10000)
    })
  })

  describe('updateConfig', () => {
    it('should update configuration for specified service', () => {
      const originalConfig = service.getOpenAIConfig()
      expect(originalConfig.maxAttempts).toBe(3)

      service.updateConfig('openai', { maxAttempts: 5 })

      const updatedConfig = service.getOpenAIConfig()
      expect(updatedConfig.maxAttempts).toBe(5)
      expect(updatedConfig.baseDelay).toBe(1000) // Should preserve other values
      expect(updatedConfig.logRetryAttempts).toBe(true) // Should preserve other values
    })

    it('should only update specified fields', () => {
      service.updateConfig('discord', { maxAttempts: 5, baseDelay: 2000 })

      const config = service.getDiscordConfig()
      expect(config.maxAttempts).toBe(5)
      expect(config.baseDelay).toBe(2000)
      expect(config.maxDelay).toBe(5000) // Should preserve original
      expect(config.jitter).toBe(true) // Should preserve original
    })
  })

  describe('getAllConfigs', () => {
    it('should return all configurations', () => {
      const allConfigs = service.getAllConfigs()

      expect(allConfigs).toHaveProperty('openai')
      expect(allConfigs).toHaveProperty('discord')
      expect(allConfigs).toHaveProperty('equationService')
      expect(allConfigs).toHaveProperty('default')

      expect(allConfigs.openai.timeout).toBe(30000)
      expect(allConfigs.discord.timeout).toBe(10000)
    })

    it('should return copies of configurations', () => {
      const allConfigs = service.getAllConfigs()
      const originalOpenai = service.getOpenAIConfig()

      expect(allConfigs.openai).not.toBe(originalOpenai)
      expect(allConfigs.openai).toEqual(originalOpenai)
    })
  })

  describe('resetToDefaults', () => {
    it('should reset all configurations to defaults', () => {
      // Modify configurations
      service.updateConfig('openai', { maxAttempts: 10 })
      service.updateConfig('discord', { baseDelay: 5000 })

      // Verify modifications
      expect(service.getOpenAIConfig().maxAttempts).toBe(10)
      expect(service.getDiscordConfig().baseDelay).toBe(5000)

      // Reset to defaults
      service.resetToDefaults()

      // Verify reset
      expect(service.getOpenAIConfig().maxAttempts).toBe(3)
      expect(service.getDiscordConfig().baseDelay).toBe(1000)
    })
  })
})

describe('getRetryConfigFromEnv', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('should return empty config when no env vars are set', () => {
    const config = getRetryConfigFromEnv()
    expect(config).toEqual({})
  })

  it('should parse OpenAI environment variables', () => {
    process.env.OPENAI_RETRY_MAX_ATTEMPTS = '5'
    process.env.OPENAI_RETRY_BASE_DELAY = '2000'
    process.env.OPENAI_RETRY_MAX_DELAY = '60000'
    process.env.OPENAI_RETRY_TIMEOUT = '45000'

    const config = getRetryConfigFromEnv()

    expect(config.openai).toEqual({
      maxAttempts: 5,
      baseDelay: 2000,
      maxDelay: 60000,
      timeout: 45000,
    })
  })

  it('should parse Discord environment variables', () => {
    process.env.DISCORD_RETRY_MAX_ATTEMPTS = '2'
    process.env.DISCORD_RETRY_BASE_DELAY = '500'
    process.env.DISCORD_RETRY_MAX_DELAY = '3000'
    process.env.DISCORD_RETRY_TIMEOUT = '8000'

    const config = getRetryConfigFromEnv()

    expect(config.discord).toEqual({
      maxAttempts: 2,
      baseDelay: 500,
      maxDelay: 3000,
      timeout: 8000,
    })
  })

  it('should parse equation service environment variables', () => {
    process.env.EQUATION_RETRY_MAX_ATTEMPTS = '4'
    process.env.EQUATION_RETRY_BASE_DELAY = '1500'
    process.env.EQUATION_RETRY_MAX_DELAY = '20000'
    process.env.EQUATION_RETRY_TIMEOUT = '12000'

    const config = getRetryConfigFromEnv()

    expect(config.equationService).toEqual({
      maxAttempts: 4,
      baseDelay: 1500,
      maxDelay: 20000,
      timeout: 12000,
    })
  })

  it('should parse mixed environment variables', () => {
    process.env.OPENAI_RETRY_MAX_ATTEMPTS = '5'
    process.env.DISCORD_RETRY_BASE_DELAY = '2000'
    process.env.EQUATION_RETRY_TIMEOUT = '15000'

    const config = getRetryConfigFromEnv()

    expect(config.openai).toEqual({
      maxAttempts: 5,
    })
    expect(config.discord).toEqual({
      baseDelay: 2000,
    })
    expect(config.equationService).toEqual({
      timeout: 15000,
    })
  })

  it('should parse media service environment variables', () => {
    process.env.SONARR_RETRY_MAX_ATTEMPTS = '5'
    process.env.SONARR_RETRY_TIMEOUT = '20000'
    process.env.RADARR_RETRY_BASE_DELAY = '2000'
    process.env.EMBY_RETRY_MAX_ATTEMPTS = '1'

    const config = getRetryConfigFromEnv()

    expect(config.sonarr).toEqual({
      maxAttempts: 5,
      timeout: 20000,
    })
    expect(config.radarr).toEqual({
      baseDelay: 2000,
    })
    expect(config.emby).toEqual({
      maxAttempts: 1,
    })
  })

  it('should handle invalid environment variables gracefully', () => {
    process.env.OPENAI_RETRY_MAX_ATTEMPTS = 'invalid'
    process.env.DISCORD_RETRY_BASE_DELAY = 'also-invalid'

    const config = getRetryConfigFromEnv()

    expect(config.openai).toEqual({
      maxAttempts: NaN,
    })
    expect(config.discord).toEqual({
      baseDelay: NaN,
    })
  })
})
