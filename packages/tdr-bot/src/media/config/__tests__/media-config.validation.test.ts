import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import {
  EmbyConfig,
  MediaConfigValidationService,
  MediaServiceConfig,
  RadarrConfig,
  SonarrConfig,
  ValidationResult,
} from 'src/media/config/media-config.validation'

// Mock ConfigService
interface ConfigService {
  get<T = any>(propertyPath: string, defaultValue?: T): T | undefined
}

describe('MediaConfigValidationService', () => {
  let service: MediaConfigValidationService
  let configService: jest.Mocked<ConfigService>
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env }

    // Mock ConfigService
    configService = {
      get: jest.fn(),
    }

    // Clear all environment variables that we're testing
    ;(process.env as any).NODE_ENV = undefined
    ;(process.env as any).SONARR_URL = undefined
    ;(process.env as any).SONARR_API_KEY = undefined
    ;(process.env as any).RADARR_URL = undefined
    ;(process.env as any).RADARR_API_KEY = undefined
    ;(process.env as any).EMBY_URL = undefined
    ;(process.env as any).EMBY_API_TOKEN = undefined
    ;(process.env as any).EMBY_USER_ID = undefined
  })

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv
    jest.clearAllMocks()
  })

  async function createService(): Promise<MediaConfigValidationService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: MediaConfigValidationService,
          useFactory: () => new MediaConfigValidationService(configService),
        },
      ],
    }).compile()

    return module.get<MediaConfigValidationService>(
      MediaConfigValidationService,
    )
  }

  describe('Service Initialization', () => {
    it('should be defined', async () => {
      service = await createService()
      expect(service).toBeDefined()
    })

    it('should initialize successfully with valid configuration', async () => {
      // Setup valid configuration via ConfigService mock
      configService.get
        .mockReturnValueOnce('http://sonarr:8989') // SONARR_URL
        .mockReturnValueOnce('sonarrapikeyabcdef1234567890abcdef') // SONARR_API_KEY
        .mockReturnValueOnce('http://radarr:7878') // RADARR_URL
        .mockReturnValueOnce('radarrapikeyabcdef1234567890abcdef') // RADARR_API_KEY
        .mockReturnValueOnce('http://emby:8096') // EMBY_URL
        .mockReturnValueOnce('embytokenabcdef1234567890abcdef') // EMBY_API_TOKEN
        .mockReturnValueOnce('12345678-1234-1234-8234-123456789012') // EMBY_USER_ID

      service = await createService()

      expect(service.onModuleInit).toBeDefined()
      await expect(service.onModuleInit()).resolves.not.toThrow()

      const config = service.getConfiguration()
      expect(config).toBeDefined()
      expect(config.sonarr.url).toBe('http://sonarr:8989')
      expect(config.radarr.url).toBe('http://radarr:7878')
      expect(config.emby.url).toBe('http://emby:8096')
    })

    it('should fail initialization with invalid configuration', async () => {
      // Setup invalid configuration (invalid API keys and user ID)
      configService.get
        .mockReturnValueOnce('http://sonarr:8989') // SONARR_URL
        .mockReturnValueOnce('short') // SONARR_API_KEY (too short)
        .mockReturnValueOnce('http://radarr:7878') // RADARR_URL
        .mockReturnValueOnce('invalid-key!') // RADARR_API_KEY (invalid chars)
        .mockReturnValueOnce('http://emby:8096') // EMBY_URL
        .mockReturnValueOnce('tooshort') // EMBY_API_TOKEN (too short)
        .mockReturnValueOnce('not-a-uuid') // EMBY_USER_ID (invalid UUID)

      service = await createService()

      await expect(service.onModuleInit()).rejects.toThrow(
        'Invalid media service configuration. Check the logs for details.',
      )
    })

    it('should log warnings for partial configuration', async () => {
      const loggerSpy = jest.spyOn(Logger.prototype, 'warn')

      // Setup configuration with warnings (localhost in production)
      ;(process.env as any).NODE_ENV = 'production'
      configService.get
        .mockReturnValueOnce('http://localhost:8989') // SONARR_URL (localhost warning)
        .mockReturnValueOnce('sonarrapikeyabcdef1234567890abcdef') // SONARR_API_KEY
        .mockReturnValueOnce('http://localhost:7878') // RADARR_URL (localhost warning)
        .mockReturnValueOnce('radarrapikeyabcdef1234567890abcdef') // RADARR_API_KEY
        .mockReturnValueOnce('http://localhost:8096') // EMBY_URL (localhost warning)
        .mockReturnValueOnce('embytokenabcdef1234567890abcdef') // EMBY_API_TOKEN
        .mockReturnValueOnce('12345678-1234-1234-8234-123456789012') // EMBY_USER_ID

      service = await createService()
      await service.onModuleInit()

      expect(loggerSpy).toHaveBeenCalledWith(
        'Media service configuration has warnings',
        expect.objectContaining({
          warnings: expect.arrayContaining([
            expect.stringContaining('localhost in production'),
          ]),
        }),
      )
    })
  })

  describe('Environment Variable Loading', () => {
    beforeEach(async () => {
      service = await createService()
    })

    it('should load configuration with default values', async () => {
      configService.get
        .mockReturnValueOnce(undefined) // SONARR_URL (will use default)
        .mockReturnValueOnce('sonarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce(undefined) // RADARR_URL (will use default)
        .mockReturnValueOnce('radarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce(undefined) // EMBY_URL (will use default)
        .mockReturnValueOnce('embytokenabcdef1234567890abcdef')
        .mockReturnValueOnce('12345678-1234-1234-8234-123456789012')

      await service.onModuleInit()

      const config = service.getConfiguration()
      expect(config.sonarr.url).toBe('http://sonarr:8989')
      expect(config.radarr.url).toBe('http://radarr:7878')
      expect(config.emby.url).toBe('http://emby:8096')
    })

    it('should load configuration with custom values', async () => {
      configService.get
        .mockReturnValueOnce('https://custom-sonarr.example.com')
        .mockReturnValueOnce('customsonarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce('https://custom-radarr.example.com')
        .mockReturnValueOnce('customradarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce('https://custom-emby.example.com')
        .mockReturnValueOnce('customembytokenabcdef1234567890abcdef')
        .mockReturnValueOnce('87654321-4321-4321-8321-210987654321')

      await service.onModuleInit()

      const config = service.getConfiguration()
      expect(config.sonarr.url).toBe('https://custom-sonarr.example.com')
      expect(config.sonarr.apiKey).toBe(
        'customsonarrapikeyabcdef1234567890abcdef',
      )
      expect(config.radarr.url).toBe('https://custom-radarr.example.com')
      expect(config.radarr.apiKey).toBe(
        'customradarrapikeyabcdef1234567890abcdef',
      )
      expect(config.emby.url).toBe('https://custom-emby.example.com')
      expect(config.emby.apiKey).toBe('customembytokenabcdef1234567890abcdef')
      expect(config.emby.userId).toBe('87654321-4321-4321-8321-210987654321')
    })

    it('should throw error for missing required environment variables', async () => {
      // Test missing SONARR_API_KEY
      configService.get
        .mockReturnValueOnce('http://sonarr:8989')
        .mockReturnValueOnce(undefined) // Missing SONARR_API_KEY

      await expect(service.onModuleInit()).rejects.toThrow(
        'Required environment variable SONARR_API_KEY is not set',
      )
    })

    it('should set default timeout and retry values', async () => {
      configService.get
        .mockReturnValueOnce('http://sonarr:8989')
        .mockReturnValueOnce('sonarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce('http://radarr:7878')
        .mockReturnValueOnce('radarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce('http://emby:8096')
        .mockReturnValueOnce('embytokenabcdef1234567890abcdef')
        .mockReturnValueOnce('12345678-1234-1234-8234-123456789012')

      await service.onModuleInit()

      const config = service.getConfiguration()
      expect(config.sonarr.timeout).toBe(30000)
      expect(config.sonarr.maxRetries).toBe(3)
      expect(config.radarr.timeout).toBe(30000)
      expect(config.radarr.maxRetries).toBe(3)
      expect(config.emby.timeout).toBe(30000)
      expect(config.emby.maxRetries).toBe(3)
    })
  })

  describe('URL Validation', () => {
    beforeEach(async () => {
      service = await createService()
    })

    it('should accept valid HTTP URLs', () => {
      const isValidUrl = (service as any).isValidUrl.bind(service)

      expect(isValidUrl('http://localhost:8989')).toBe(true)
      expect(isValidUrl('http://sonarr:8989')).toBe(true)
      expect(isValidUrl('http://192.168.1.100:8989')).toBe(true)
    })

    it('should accept valid HTTPS URLs', () => {
      const isValidUrl = (service as any).isValidUrl.bind(service)

      expect(isValidUrl('https://sonarr.example.com')).toBe(true)
      expect(isValidUrl('https://192.168.1.100:8989')).toBe(true)
      expect(isValidUrl('https://subdomain.example.com:9999')).toBe(true)
    })

    it('should reject invalid URLs', () => {
      const isValidUrl = (service as any).isValidUrl.bind(service)

      expect(isValidUrl('not-a-url')).toBe(false)
      expect(isValidUrl('ftp://sonarr:8989')).toBe(false)
      expect(isValidUrl('file://localhost/path')).toBe(false)
      expect(isValidUrl('')).toBe(false)
      expect(isValidUrl('javascript:alert(1)')).toBe(false)
    })

    it('should handle malformed URLs gracefully', () => {
      const isValidUrl = (service as any).isValidUrl.bind(service)

      expect(isValidUrl('http://')).toBe(false)
      expect(isValidUrl('https://')).toBe(false)
      expect(isValidUrl('http://[invalid-ipv6')).toBe(false)
      expect(isValidUrl('http:// invalid-space')).toBe(false)
    })
  })

  describe('API Key Validation', () => {
    beforeEach(async () => {
      service = await createService()
    })

    it('should accept valid API keys', () => {
      const isValidApiKey = (service as any).isValidApiKey.bind(service)

      expect(isValidApiKey('1234567890abcdef1234567890abcdef')).toBe(true)
      expect(isValidApiKey('ABCDEF1234567890abcdef1234567890')).toBe(true)
      expect(isValidApiKey('0123456789abcdefABCDEF0123456789')).toBe(true)
    })

    it('should reject short API keys', () => {
      const isValidApiKey = (service as any).isValidApiKey.bind(service)

      expect(isValidApiKey('short')).toBe(false)
      expect(isValidApiKey('1234567890abcde')).toBe(false) // 15 chars (need 16+)
      expect(isValidApiKey('')).toBe(false)
    })

    it('should reject API keys with invalid characters', () => {
      const isValidApiKey = (service as any).isValidApiKey.bind(service)

      expect(isValidApiKey('1234567890abcdef-invalid')).toBe(false)
      expect(isValidApiKey('1234567890abcdef_invalid')).toBe(false)
      expect(isValidApiKey('1234567890abcdef@invalid')).toBe(false)
      expect(isValidApiKey('1234567890abcdef invalid')).toBe(false)
    })
  })

  describe('Emby User ID Validation', () => {
    beforeEach(async () => {
      service = await createService()
    })

    it('should accept valid UUIDs', () => {
      const isValidEmbyUserId = (service as any).isValidEmbyUserId.bind(service)

      expect(isValidEmbyUserId('12345678-1234-1234-8234-123456789012')).toBe(
        true,
      )
      expect(isValidEmbyUserId('87654321-4321-5678-9abc-def123456789')).toBe(
        true,
      )
      expect(isValidEmbyUserId('00000000-0000-1000-8000-000000000000')).toBe(
        true,
      )
    })

    it('should reject invalid UUID formats', () => {
      const isValidEmbyUserId = (service as any).isValidEmbyUserId.bind(service)

      expect(isValidEmbyUserId('not-a-uuid')).toBe(false)
      expect(isValidEmbyUserId('12345678-1234-1234-1234')).toBe(false) // Too short
      expect(isValidEmbyUserId('12345678-1234-1234-8234-123456789012345')).toBe(
        false,
      ) // Too long
      expect(isValidEmbyUserId('12345678-1234-1234-1234-12345678901g')).toBe(
        false,
      ) // Invalid hex
      expect(isValidEmbyUserId('')).toBe(false)
    })

    it('should handle case insensitive UUIDs', () => {
      const isValidEmbyUserId = (service as any).isValidEmbyUserId.bind(service)

      expect(isValidEmbyUserId('ABCDEF12-3456-1890-ABCD-EF1234567890')).toBe(
        true,
      )
      expect(isValidEmbyUserId('abcdef12-3456-1890-abcd-ef1234567890')).toBe(
        true,
      )
      expect(isValidEmbyUserId('AbCdEf12-3456-1890-AbCd-Ef1234567890')).toBe(
        true,
      )
    })
  })

  describe('Service-Specific Validation', () => {
    beforeEach(async () => {
      service = await createService()
    })

    describe('Sonarr Configuration Validation', () => {
      it('should validate valid Sonarr configuration', () => {
        const validateSonarrConfig = (service as any).validateSonarrConfig.bind(
          service,
        )

        const config: SonarrConfig = {
          url: 'http://sonarr:8989',
          apiKey: '1234567890abcdef1234567890abcdef',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        }

        const result = validateSonarrConfig(config)

        expect(result.errors).toHaveLength(0)
        expect(result.warnings).toHaveLength(0)
        expect(result.status).toBe('valid')
      })

      it('should detect invalid Sonarr URL', () => {
        const validateSonarrConfig = (service as any).validateSonarrConfig.bind(
          service,
        )

        const config: SonarrConfig = {
          url: 'invalid-url',
          apiKey: '1234567890abcdef1234567890abcdef',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        }

        const result = validateSonarrConfig(config)

        expect(result.errors).toContain('Invalid Sonarr URL: invalid-url')
        expect(result.status).toBe('invalid')
      })

      it('should detect invalid Sonarr API key', () => {
        const validateSonarrConfig = (service as any).validateSonarrConfig.bind(
          service,
        )

        const config: SonarrConfig = {
          url: 'http://sonarr:8989',
          apiKey: 'short',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        }

        const result = validateSonarrConfig(config)

        expect(result.errors).toContain('Invalid Sonarr API key format')
        expect(result.status).toBe('invalid')
      })

      it('should warn about localhost in production', () => {
        ;(process.env as any).NODE_ENV = 'production'
        const validateSonarrConfig = (service as any).validateSonarrConfig.bind(
          service,
        )

        const config: SonarrConfig = {
          url: 'http://localhost:8989',
          apiKey: '1234567890abcdef1234567890abcdef',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        }

        const result = validateSonarrConfig(config)

        expect(result.warnings).toContain(
          'Sonarr URL uses localhost in production environment',
        )
        expect(result.status).toBe('partial') // Warnings make it partial
      })

      it('should warn about timeout outside recommended range', () => {
        const validateSonarrConfig = (service as any).validateSonarrConfig.bind(
          service,
        )

        const config: SonarrConfig = {
          url: 'http://sonarr:8989',
          apiKey: '1234567890abcdef1234567890abcdef',
          timeout: 150000, // Too high
          maxRetries: 3,
          isValidated: false,
        }

        const result = validateSonarrConfig(config)

        expect(result.warnings).toContain(
          'Sonarr timeout (150000ms) outside recommended range (5000-120000ms)',
        )
        expect(result.status).toBe('partial') // Warnings make it partial
      })
    })

    describe('Radarr Configuration Validation', () => {
      it('should validate valid Radarr configuration', () => {
        const validateRadarrConfig = (service as any).validateRadarrConfig.bind(
          service,
        )

        const config: RadarrConfig = {
          url: 'http://radarr:7878',
          apiKey: '1234567890abcdef1234567890abcdef',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        }

        const result = validateRadarrConfig(config)

        expect(result.errors).toHaveLength(0)
        expect(result.warnings).toHaveLength(0)
        expect(result.status).toBe('valid')
      })

      it('should detect invalid Radarr URL', () => {
        const validateRadarrConfig = (service as any).validateRadarrConfig.bind(
          service,
        )

        const config: RadarrConfig = {
          url: 'ftp://radarr:7878',
          apiKey: '1234567890abcdef1234567890abcdef',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        }

        const result = validateRadarrConfig(config)

        expect(result.errors).toContain('Invalid Radarr URL: ftp://radarr:7878')
        expect(result.status).toBe('invalid')
      })

      it('should detect invalid Radarr API key', () => {
        const validateRadarrConfig = (service as any).validateRadarrConfig.bind(
          service,
        )

        const config: RadarrConfig = {
          url: 'http://radarr:7878',
          apiKey: 'invalid-key!',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        }

        const result = validateRadarrConfig(config)

        expect(result.errors).toContain('Invalid Radarr API key format')
        expect(result.status).toBe('invalid')
      })
    })

    describe('Emby Configuration Validation', () => {
      it('should validate valid Emby configuration', () => {
        const validateEmbyConfig = (service as any).validateEmbyConfig.bind(
          service,
        )

        const config: EmbyConfig = {
          url: 'http://emby:8096',
          apiKey: '1234567890abcdef1234567890abcdef',
          userId: '12345678-1234-1234-8234-123456789012',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        }

        const result = validateEmbyConfig(config)

        expect(result.errors).toHaveLength(0)
        expect(result.warnings).toHaveLength(0)
        expect(result.status).toBe('valid')
      })

      it('should detect invalid Emby URL', () => {
        const validateEmbyConfig = (service as any).validateEmbyConfig.bind(
          service,
        )

        const config: EmbyConfig = {
          url: 'not-a-url',
          apiKey: '1234567890abcdef1234567890abcdef',
          userId: '12345678-1234-1234-8234-123456789012',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        }

        const result = validateEmbyConfig(config)

        expect(result.errors).toContain('Invalid Emby URL: not-a-url')
        expect(result.status).toBe('invalid')
      })

      it('should detect invalid Emby API key', () => {
        const validateEmbyConfig = (service as any).validateEmbyConfig.bind(
          service,
        )

        const config: EmbyConfig = {
          url: 'http://emby:8096',
          apiKey: 'short',
          userId: '12345678-1234-1234-8234-123456789012',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        }

        const result = validateEmbyConfig(config)

        expect(result.errors).toContain('Invalid Emby API key format')
        expect(result.status).toBe('invalid')
      })

      it('should detect invalid Emby User ID', () => {
        const validateEmbyConfig = (service as any).validateEmbyConfig.bind(
          service,
        )

        const config: EmbyConfig = {
          url: 'http://emby:8096',
          apiKey: '1234567890abcdef1234567890abcdef',
          userId: 'not-a-uuid',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        }

        const result = validateEmbyConfig(config)

        expect(result.errors).toContain(
          'Invalid Emby User ID format (should be a valid UUID)',
        )
        expect(result.status).toBe('invalid')
      })
    })
  })

  describe('Complete Configuration Validation', () => {
    beforeEach(async () => {
      service = await createService()
    })

    it('should validate complete valid configuration', () => {
      const validateConfiguration = (service as any).validateConfiguration.bind(
        service,
      )

      const config: MediaServiceConfig = {
        sonarr: {
          url: 'http://sonarr:8989',
          apiKey: '1234567890abcdef1234567890abcdef',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        },
        radarr: {
          url: 'http://radarr:7878',
          apiKey: '1234567890abcdef1234567890abcdef',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        },
        emby: {
          url: 'http://emby:8096',
          apiKey: '1234567890abcdef1234567890abcdef',
          userId: '12345678-1234-1234-8234-123456789012',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        },
      }

      const result: ValidationResult = validateConfiguration(config)

      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.warnings).toHaveLength(0)
      expect(result.serviceStatus.sonarr).toBe('valid')
      expect(result.serviceStatus.radarr).toBe('valid')
      expect(result.serviceStatus.emby).toBe('valid')
    })

    it('should detect multiple configuration errors', () => {
      const validateConfiguration = (service as any).validateConfiguration.bind(
        service,
      )

      const config: MediaServiceConfig = {
        sonarr: {
          url: 'invalid-url',
          apiKey: 'short',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        },
        radarr: {
          url: 'also-invalid',
          apiKey: 'too-short',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        },
        emby: {
          url: 'bad-url',
          apiKey: 'bad-key',
          userId: 'not-uuid',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        },
      }

      const result: ValidationResult = validateConfiguration(config)

      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.serviceStatus.sonarr).toBe('invalid')
      expect(result.serviceStatus.radarr).toBe('invalid')
      expect(result.serviceStatus.emby).toBe('invalid')
    })

    it('should handle mixed valid/invalid services', () => {
      const validateConfiguration = (service as any).validateConfiguration.bind(
        service,
      )

      const config: MediaServiceConfig = {
        sonarr: {
          url: 'http://sonarr:8989',
          apiKey: '1234567890abcdef1234567890abcdef',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        },
        radarr: {
          url: 'invalid-url',
          apiKey: 'short',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        },
        emby: {
          url: 'http://emby:8096',
          apiKey: '1234567890abcdef1234567890abcdef',
          userId: '12345678-1234-1234-8234-123456789012',
          timeout: 30000,
          maxRetries: 3,
          isValidated: false,
        },
      }

      const result: ValidationResult = validateConfiguration(config)

      expect(result.isValid).toBe(false) // Invalid because of Radarr errors
      expect(result.serviceStatus.sonarr).toBe('valid')
      expect(result.serviceStatus.radarr).toBe('invalid')
      expect(result.serviceStatus.emby).toBe('valid')
    })
  })

  describe('Service Guidance and Error Messages', () => {
    beforeEach(async () => {
      service = await createService()
    })

    it('should log service-specific guidance for invalid configurations', () => {
      const loggerSpy = jest.spyOn(Logger.prototype, 'error')
      const logServiceGuidance = (service as any).logServiceGuidance.bind(
        service,
      )

      const validation: ValidationResult = {
        isValid: false,
        errors: [
          'Invalid Sonarr URL: invalid-url',
          'Invalid Radarr API key format',
          'Invalid Emby User ID format (should be a valid UUID)',
        ],
        warnings: [],
        serviceStatus: {
          sonarr: 'invalid',
          radarr: 'invalid',
          emby: 'invalid',
        },
      }

      logServiceGuidance(validation)

      expect(loggerSpy).toHaveBeenCalledWith(
        'Sonarr Configuration Issues:',
        expect.objectContaining({
          requiredVars: ['SONARR_URL', 'SONARR_API_KEY'],
          defaultUrl: 'http://sonarr:8989',
          guidance: 'Check Sonarr container is running and API key is correct',
          errors: expect.arrayContaining([expect.stringContaining('Sonarr')]),
        }),
      )

      expect(loggerSpy).toHaveBeenCalledWith(
        'Radarr Configuration Issues:',
        expect.objectContaining({
          requiredVars: ['RADARR_URL', 'RADARR_API_KEY'],
          defaultUrl: 'http://radarr:7878',
          guidance: 'Check Radarr container is running and API key is correct',
          errors: expect.arrayContaining([expect.stringContaining('Radarr')]),
        }),
      )

      expect(loggerSpy).toHaveBeenCalledWith(
        'Emby Configuration Issues:',
        expect.objectContaining({
          requiredVars: ['EMBY_URL', 'EMBY_API_TOKEN', 'EMBY_USER_ID'],
          defaultUrl: 'http://emby:8096',
          guidance:
            'Check Emby container is running, API key is correct, and User ID is valid UUID',
          errors: expect.arrayContaining([expect.stringContaining('Emby')]),
        }),
      )
    })
  })

  describe('Configuration Access Methods', () => {
    beforeEach(async () => {
      // Setup valid configuration
      configService.get
        .mockReturnValueOnce('http://sonarr:8989')
        .mockReturnValueOnce('sonarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce('http://radarr:7878')
        .mockReturnValueOnce('radarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce('http://emby:8096')
        .mockReturnValueOnce('embytokenabcdef1234567890abcdef')
        .mockReturnValueOnce('12345678-1234-1234-8234-123456789012')

      service = await createService()
      await service.onModuleInit()
    })

    it('should return complete configuration', () => {
      const config = service.getConfiguration()

      expect(config).toMatchObject({
        sonarr: expect.objectContaining({
          url: 'http://sonarr:8989',
          apiKey: 'sonarrapikeyabcdef1234567890abcdef',
        }),
        radarr: expect.objectContaining({
          url: 'http://radarr:7878',
          apiKey: 'radarrapikeyabcdef1234567890abcdef',
        }),
        emby: expect.objectContaining({
          url: 'http://emby:8096',
          apiKey: 'embytokenabcdef1234567890abcdef',
          userId: '12345678-1234-1234-8234-123456789012',
        }),
      })
    })

    it('should return specific service configurations', () => {
      const sonarrConfig = service.getServiceConfig('sonarr')
      const radarrConfig = service.getServiceConfig('radarr')
      const embyConfig = service.getServiceConfig('emby')

      expect(sonarrConfig.url).toBe('http://sonarr:8989')
      expect(radarrConfig.url).toBe('http://radarr:7878')
      expect(embyConfig.url).toBe('http://emby:8096')
      expect((embyConfig as EmbyConfig).userId).toBe(
        '12345678-1234-1234-8234-123456789012',
      )
    })

    it('should throw error when accessing configuration before initialization', async () => {
      const uninitializedService = await createService()

      expect(() => uninitializedService.getConfiguration()).toThrow(
        'Media configuration not initialized. Call onModuleInit() first.',
      )
    })

    it('should return last validation result', () => {
      const validation = service.getLastValidation()

      expect(validation).toMatchObject({
        isValid: true,
        errors: [],
        serviceStatus: {
          sonarr: 'valid',
          radarr: 'valid',
          emby: 'valid',
        },
      })
    })

    it('should throw error when accessing validation before initialization', async () => {
      const uninitializedService = await createService()

      expect(() => uninitializedService.getLastValidation()).toThrow(
        'No validation has been performed yet',
      )
    })
  })

  describe('Configuration Revalidation', () => {
    beforeEach(async () => {
      configService.get
        .mockReturnValueOnce('http://sonarr:8989')
        .mockReturnValueOnce('sonarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce('http://radarr:7878')
        .mockReturnValueOnce('radarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce('http://emby:8096')
        .mockReturnValueOnce('embytokenabcdef1234567890abcdef')
        .mockReturnValueOnce('12345678-1234-1234-8234-123456789012')

      service = await createService()
      await service.onModuleInit()
    })

    it('should revalidate existing configuration', () => {
      const originalValidation = service.getLastValidation()
      expect(originalValidation.isValid).toBe(true)

      const revalidationResult = service.revalidateConfiguration()

      expect(revalidationResult.isValid).toBe(true)
      expect(revalidationResult).toMatchObject({
        isValid: true,
        errors: [],
        serviceStatus: {
          sonarr: 'valid',
          radarr: 'valid',
          emby: 'valid',
        },
      })
    })

    it('should update last validation result after revalidation', () => {
      const originalValidation = service.getLastValidation()
      const originalTimestamp = originalValidation

      service.revalidateConfiguration()

      const updatedValidation = service.getLastValidation()
      expect(updatedValidation).not.toBe(originalTimestamp) // Different object reference
    })

    it('should throw error when revalidating before initialization', async () => {
      const uninitializedService = await createService()

      expect(() => uninitializedService.revalidateConfiguration()).toThrow(
        'Media configuration not initialized',
      )
    })
  })

  describe('Service Availability Checking', () => {
    beforeEach(async () => {
      configService.get
        .mockReturnValueOnce('http://sonarr:8989')
        .mockReturnValueOnce('sonarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce('http://radarr:7878')
        .mockReturnValueOnce('radarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce('http://emby:8096')
        .mockReturnValueOnce('embytokenabcdef1234567890abcdef')
        .mockReturnValueOnce('12345678-1234-1234-8234-123456789012')

      service = await createService()
      await service.onModuleInit()
    })

    it('should confirm all services are valid when properly configured', () => {
      expect(service.areAllServicesValid()).toBe(true)
    })

    it('should return all available services when all are valid', () => {
      const availableServices = service.getAvailableServices()

      expect(availableServices).toEqual(['sonarr', 'radarr', 'emby'])
    })

    it('should return only valid services when some are invalid', async () => {
      // Create service with mixed valid/invalid config
      configService.get
        .mockReturnValueOnce('http://sonarr:8989')
        .mockReturnValueOnce('sonarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce('invalid-url') // Invalid Radarr URL
        .mockReturnValueOnce('radarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce('http://emby:8096')
        .mockReturnValueOnce('embytokenabcdef1234567890abcdef')
        .mockReturnValueOnce('12345678-1234-1234-8234-123456789012')

      const mixedService = await createService()

      // Should not throw during init since we have valid services
      try {
        await mixedService.onModuleInit()
      } catch {
        // Expected to fail due to invalid config, but we can still test methods
        // by manually setting up the state
        const config: MediaServiceConfig = {
          sonarr: {
            url: 'http://sonarr:8989',
            apiKey: 'sonarrapikeyabcdef1234567890abcdef',
            timeout: 30000,
            maxRetries: 3,
            isValidated: false,
          },
          radarr: {
            url: 'invalid-url',
            apiKey: 'radarrapikeyabcdef1234567890abcdef',
            timeout: 30000,
            maxRetries: 3,
            isValidated: false,
          },
          emby: {
            url: 'http://emby:8096',
            apiKey: 'embytokenabcdef1234567890abcdef',
            userId: '12345678-1234-1234-8234-123456789012',
            timeout: 30000,
            maxRetries: 3,
            isValidated: false,
          },
        }

        // Set the config manually for testing
        ;(mixedService as any).mediaConfig = config
        ;(mixedService as any).lastValidation = (
          mixedService as any
        ).validateConfiguration(config)

        const availableServices = mixedService.getAvailableServices()
        expect(availableServices).toEqual(['sonarr', 'emby'])
        expect(mixedService.areAllServicesValid()).toBe(false)
      }
    })
  })

  describe('Edge Cases and Error Handling', () => {
    beforeEach(async () => {
      service = await createService()
    })

    it('should handle extremely short timeout values', () => {
      const validateSonarrConfig = (service as any).validateSonarrConfig.bind(
        service,
      )

      const config: SonarrConfig = {
        url: 'http://sonarr:8989',
        apiKey: '1234567890abcdef1234567890abcdef',
        timeout: 1000, // Very short timeout
        maxRetries: 3,
        isValidated: false,
      }

      const result = validateSonarrConfig(config)

      expect(result.warnings).toContain(
        'Sonarr timeout (1000ms) outside recommended range (5000-120000ms)',
      )
      expect(result.status).toBe('partial') // Warnings make it partial
    })

    it('should handle extremely long timeout values', () => {
      const validateEmbyConfig = (service as any).validateEmbyConfig.bind(
        service,
      )

      const config: EmbyConfig = {
        url: 'http://emby:8096',
        apiKey: '1234567890abcdef1234567890abcdef',
        userId: '12345678-1234-1234-8234-123456789012',
        timeout: 300000, // Very long timeout (5 minutes)
        maxRetries: 3,
        isValidated: false,
      }

      const result = validateEmbyConfig(config)

      expect(result.warnings).toContain(
        'Emby timeout (300000ms) outside recommended range (5000-120000ms)',
      )
      expect(result.status).toBe('partial') // Warnings make it partial
    })

    it('should handle empty string values', () => {
      const isValidUrl = (service as any).isValidUrl.bind(service)
      const isValidApiKey = (service as any).isValidApiKey.bind(service)
      const isValidEmbyUserId = (service as any).isValidEmbyUserId.bind(service)

      expect(isValidUrl('')).toBe(false)
      expect(isValidApiKey('')).toBe(false)
      expect(isValidEmbyUserId('')).toBe(false)
    })

    it('should handle null/undefined values gracefully', () => {
      const isValidUrl = (service as any).isValidUrl.bind(service)
      const isValidApiKey = (service as any).isValidApiKey.bind(service)
      const isValidEmbyUserId = (service as any).isValidEmbyUserId.bind(service)

      // These should not throw errors
      expect(isValidUrl(null as any)).toBe(false)
      expect(isValidApiKey(undefined as any)).toBe(false)
      expect(isValidEmbyUserId(null as any)).toBe(false)
    })

    it('should handle non-production environments correctly', () => {
      ;(process.env as any).NODE_ENV = 'development'
      const validateSonarrConfig = (service as any).validateSonarrConfig.bind(
        service,
      )

      const config: SonarrConfig = {
        url: 'http://localhost:8989',
        apiKey: '1234567890abcdef1234567890abcdef',
        timeout: 30000,
        maxRetries: 3,
        isValidated: false,
      }

      const result = validateSonarrConfig(config)

      // Should not warn about localhost in development
      expect(result.warnings).not.toContain(
        expect.stringContaining('localhost in production'),
      )
      expect(result.status).toBe('valid') // No warnings in development
    })
  })

  describe('Timeout and Retry Configuration', () => {
    beforeEach(async () => {
      service = await createService()
    })

    it('should use default timeout and retry values', async () => {
      configService.get
        .mockReturnValueOnce('http://sonarr:8989')
        .mockReturnValueOnce('sonarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce('http://radarr:7878')
        .mockReturnValueOnce('radarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce('http://emby:8096')
        .mockReturnValueOnce('embytokenabcdef1234567890abcdef')
        .mockReturnValueOnce('12345678-1234-1234-8234-123456789012')

      await service.onModuleInit()

      const config = service.getConfiguration()

      expect(config.sonarr.timeout).toBe(30000)
      expect(config.sonarr.maxRetries).toBe(3)
      expect(config.radarr.timeout).toBe(30000)
      expect(config.radarr.maxRetries).toBe(3)
      expect(config.emby.timeout).toBe(30000)
      expect(config.emby.maxRetries).toBe(3)
    })

    it('should mark configurations as unvalidated initially', async () => {
      configService.get
        .mockReturnValueOnce('http://sonarr:8989')
        .mockReturnValueOnce('sonarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce('http://radarr:7878')
        .mockReturnValueOnce('radarrapikeyabcdef1234567890abcdef')
        .mockReturnValueOnce('http://emby:8096')
        .mockReturnValueOnce('embytokenabcdef1234567890abcdef')
        .mockReturnValueOnce('12345678-1234-1234-8234-123456789012')

      await service.onModuleInit()

      const config = service.getConfiguration()

      expect(config.sonarr.isValidated).toBe(false)
      expect(config.radarr.isValidated).toBe(false)
      expect(config.emby.isValidated).toBe(false)
    })
  })
})
