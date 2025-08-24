/**
 * Type-safe mock interfaces for testing
 *
 * This module provides properly typed mock interfaces to replace 'as any' assertions
 * throughout the test suite, improving type safety and test reliability.
 */

import type { Logger } from '@nestjs/common'
import type { AxiosInstance } from 'axios'
import type {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'

import type {
  EmbyConfig,
  MediaConfigValidationService,
  RadarrConfig,
  SonarrConfig,
  ValidationResult,
} from 'src/media/config/media-config.validation'
import type { MediaLoggingService } from 'src/media/services/media-logging.service'
import type { ErrorClassificationService } from 'src/utils/error-classifier'
import type { RetryService } from 'src/utils/retry.service'

// Re-export types that are needed by other test files
export type {
  EmbyConfig,
  MediaConfigValidationService,
  RadarrConfig,
  SonarrConfig,
  ValidationResult,
}

/**
 * Type-safe Axios instance mock - Compatible with jest.Mocked<AxiosStatic>
 */
export interface MockAxiosInstance extends jest.Mocked<AxiosInstance> {
  // Axios instance methods
  request: jest.MockedFunction<AxiosInstance['request']>
  get: jest.MockedFunction<AxiosInstance['get']>
  post: jest.MockedFunction<AxiosInstance['post']>
  put: jest.MockedFunction<AxiosInstance['put']>
  delete: jest.MockedFunction<AxiosInstance['delete']>
  patch: jest.MockedFunction<AxiosInstance['patch']>
  head: jest.MockedFunction<AxiosInstance['head']>
  options: jest.MockedFunction<AxiosInstance['options']>
  postForm: jest.MockedFunction<AxiosInstance['postForm']>
  putForm: jest.MockedFunction<AxiosInstance['putForm']>
  patchForm: jest.MockedFunction<AxiosInstance['patchForm']>

  // Interceptors with proper typing
  interceptors: {
    request: {
      use: jest.MockedFunction<(...args: unknown[]) => number>
      eject: jest.MockedFunction<(id: number) => void>
      clear: jest.MockedFunction<() => void>
    }
    response: {
      use: jest.MockedFunction<(...args: unknown[]) => number>
      eject: jest.MockedFunction<(id: number) => void>
      clear: jest.MockedFunction<() => void>
    }
  }

  // Instance properties
  defaults: jest.Mocked<AxiosInstance['defaults']>

  // Support for indexing (needed by some tests)
  [key: string]: unknown
}

/**
 * Type-safe Axios response mock
 */
export interface MockAxiosResponse<T = unknown> {
  data: T
  status: number
  statusText: string
  headers: Record<string, string>
  config: {
    headers?: Record<string, string>
  }
}

/**
 * Type-safe Logger mock
 */
export interface MockLogger {
  debug: jest.MockedFunction<Logger['debug']>
  log: jest.MockedFunction<Logger['log']>
  error: jest.MockedFunction<Logger['error']>
  warn: jest.MockedFunction<Logger['warn']>
  verbose: jest.MockedFunction<Logger['verbose']>
  fatal: jest.MockedFunction<(...args: unknown[]) => void>
  setContext: jest.MockedFunction<(context: string) => void>
  localInstance: jest.MockedFunction<() => Logger>
  registerLocalInstanceRef: jest.MockedFunction<() => void>
  options?: Record<string, unknown>
}

/**
 * Type-safe RetryService mock
 */
export interface MockRetryService {
  executeWithRetry: jest.MockedFunction<RetryService['executeWithRetry']>
  errorClassifier: MockErrorClassificationService
  defaultConfig: {
    maxAttempts: number
    baseDelay: number
    maxDelay: number
    backoffFactor: number
    jitter: boolean
    timeout: number
    logRetryAttempts: boolean
    logSuccessfulRetries: boolean
    logFailedRetries: boolean
    logRetryDelays: boolean
    logErrorDetails: boolean
    logSeverityThreshold: unknown
  }
  shouldLogBasedOnSeverity: jest.MockedFunction<(severity: unknown) => boolean>
  calculateDelay: jest.MockedFunction<(attempt: number) => number>
  sleep: jest.MockedFunction<(ms: number) => Promise<void>>
  executeWithTimeout: jest.MockedFunction<
    (fn: () => Promise<unknown>, timeout: number) => Promise<unknown>
  >
}

/**
 * Type-safe ErrorClassificationService mock
 */
export interface MockErrorClassificationService {
  classifyError: jest.MockedFunction<
    ErrorClassificationService['classifyError']
  >
  shouldRetry: jest.MockedFunction<ErrorClassificationService['shouldRetry']>
  getRetryDelay: jest.MockedFunction<
    ErrorClassificationService['getRetryDelay']
  >
  logger: MockLogger
}

/**
 * Type-safe MediaLoggingService mock
 */
export interface MockMediaLoggingService {
  createCorrelationContext: jest.MockedFunction<
    MediaLoggingService['createCorrelationContext']
  >
  logOperation: jest.MockedFunction<MediaLoggingService['logOperation']>
  logComponentInteraction: jest.MockedFunction<
    MediaLoggingService['logComponentInteraction']
  >
  logDiscordError: jest.MockedFunction<MediaLoggingService['logDiscordError']>
  logPerformance: jest.MockedFunction<MediaLoggingService['logPerformance']>
  logApiCall: jest.MockedFunction<MediaLoggingService['logApiCall']>
  logError: jest.MockedFunction<MediaLoggingService['logError']>
  logMediaSearch: jest.MockedFunction<MediaLoggingService['logMediaSearch']>
  logMediaRequest: jest.MockedFunction<MediaLoggingService['logMediaRequest']>
  getPerformanceMetrics: jest.MockedFunction<
    MediaLoggingService['getPerformanceMetrics']
  >
  getApiCallLogs: jest.MockedFunction<MediaLoggingService['getApiCallLogs']>
  getMetricsSummary: jest.MockedFunction<
    MediaLoggingService['getMetricsSummary']
  >
}

/**
 * Type-safe MediaConfigValidationService mock
 */
export interface MockMediaConfigValidationService {
  getServiceConfig: jest.MockedFunction<
    MediaConfigValidationService['getServiceConfig']
  >
  getConfiguration: jest.MockedFunction<
    MediaConfigValidationService['getConfiguration']
  >
  getLastValidation: jest.MockedFunction<
    MediaConfigValidationService['getLastValidation']
  >
  revalidateConfiguration: jest.MockedFunction<
    MediaConfigValidationService['revalidateConfiguration']
  >
  areAllServicesValid: jest.MockedFunction<
    MediaConfigValidationService['areAllServicesValid']
  >
  getAvailableServices: jest.MockedFunction<
    MediaConfigValidationService['getAvailableServices']
  >
  onModuleInit: jest.MockedFunction<
    MediaConfigValidationService['onModuleInit']
  >
  validateSonarrConfig: jest.MockedFunction<(config: SonarrConfig) => void>
  validateRadarrConfig: jest.MockedFunction<(config: RadarrConfig) => void>
  validateEmbyConfig: jest.MockedFunction<(config: EmbyConfig) => void>
}

/**
 * Type-safe RequestValidationUtils mock for static methods
 */
export interface MockRequestValidationUtils {
  validateSonarrSeriesRequest: jest.MockedFunction<
    (data: unknown, correlationId: string) => unknown
  >
  validateRadarrMovieRequest: jest.MockedFunction<
    (data: unknown, correlationId: string) => unknown
  >
}

/**
 * Type-safe Discord component builder mocks
 */

// RestOrArray type definition to match Discord.js
type RestOrArray<T> = T[] | [T[]]

// Mock action row with proper generic typing
export interface MockActionRowBuilder<
  T extends
    | ButtonBuilder
    | StringSelectMenuBuilder
    | TextInputBuilder = ButtonBuilder,
> {
  components: T[]
  addComponents: jest.MockedFunction<
    (...components: RestOrArray<T>) => ActionRowBuilder<T>
  >
  toJSON: jest.MockedFunction<ActionRowBuilder<T>['toJSON']>
}

// Enhanced action row factory that tracks components
export interface MockActionRowBuilderWithTracking<
  T extends
    | ButtonBuilder
    | StringSelectMenuBuilder
    | TextInputBuilder = ButtonBuilder,
> {
  components: T[]
  data: Record<string, unknown>
  setId: jest.MockedFunction<
    (id: number) => MockActionRowBuilderWithTracking<T>
  >
  clearId: jest.MockedFunction<() => MockActionRowBuilderWithTracking<T>>
  setComponents: jest.MockedFunction<
    (...components: RestOrArray<T>) => MockActionRowBuilderWithTracking<T>
  >
  addComponents: jest.MockedFunction<
    (...components: RestOrArray<T>) => MockActionRowBuilderWithTracking<T>
  >
  toJSON: jest.MockedFunction<() => { type: 1; components: unknown[] }>
}

export interface MockButtonBuilder {
  data: {
    custom_id?: string
    label?: string
    style?: ButtonStyle
    emoji?: { name?: string; id?: string }
    url?: string
    disabled?: boolean
  }
  setCustomId: jest.MockedFunction<ButtonBuilder['setCustomId']>
  setLabel: jest.MockedFunction<ButtonBuilder['setLabel']>
  setStyle: jest.MockedFunction<ButtonBuilder['setStyle']>
  setEmoji: jest.MockedFunction<ButtonBuilder['setEmoji']>
  setURL: jest.MockedFunction<ButtonBuilder['setURL']>
  setDisabled: jest.MockedFunction<ButtonBuilder['setDisabled']>
  toJSON: jest.MockedFunction<ButtonBuilder['toJSON']>
}

export interface MockStringSelectMenuBuilder {
  data: {
    custom_id?: string
    placeholder?: string
    options?: Array<{
      label: string
      value: string
      description?: string
      emoji?: { name?: string; id?: string }
      default?: boolean
    }>
    max_values?: number
    min_values?: number
    disabled?: boolean
  }
  setCustomId: jest.MockedFunction<StringSelectMenuBuilder['setCustomId']>
  setPlaceholder: jest.MockedFunction<StringSelectMenuBuilder['setPlaceholder']>
  setOptions: jest.MockedFunction<StringSelectMenuBuilder['setOptions']>
  addOptions: jest.MockedFunction<StringSelectMenuBuilder['addOptions']>
  setMaxValues: jest.MockedFunction<StringSelectMenuBuilder['setMaxValues']>
  setMinValues: jest.MockedFunction<StringSelectMenuBuilder['setMinValues']>
  setDisabled: jest.MockedFunction<StringSelectMenuBuilder['setDisabled']>
  toJSON: jest.MockedFunction<StringSelectMenuBuilder['toJSON']>
}

export interface MockStringSelectMenuOptionBuilder {
  data: {
    label: string
    value: string
    description?: string
    emoji?: { name?: string; id?: string }
    default?: boolean
  }
  setLabel: jest.MockedFunction<StringSelectMenuOptionBuilder['setLabel']>
  setValue: jest.MockedFunction<StringSelectMenuOptionBuilder['setValue']>
  setDescription: jest.MockedFunction<
    StringSelectMenuOptionBuilder['setDescription']
  >
  setEmoji: jest.MockedFunction<StringSelectMenuOptionBuilder['setEmoji']>
  setDefault: jest.MockedFunction<StringSelectMenuOptionBuilder['setDefault']>
  toJSON: jest.MockedFunction<StringSelectMenuOptionBuilder['toJSON']>
}

export interface MockModalBuilder {
  data: {
    custom_id?: string
    title?: string
    components?: Array<Record<string, unknown>>
  }
  setCustomId: jest.MockedFunction<ModalBuilder['setCustomId']>
  setTitle: jest.MockedFunction<ModalBuilder['setTitle']>
  addComponents: jest.MockedFunction<ModalBuilder['addComponents']>
  toJSON: jest.MockedFunction<ModalBuilder['toJSON']>
}

export interface MockTextInputBuilder {
  data: {
    custom_id?: string
    label?: string
    style?: TextInputStyle
    placeholder?: string
    required?: boolean
    min_length?: number
    max_length?: number
    value?: string
  }
  setCustomId: jest.MockedFunction<TextInputBuilder['setCustomId']>
  setLabel: jest.MockedFunction<TextInputBuilder['setLabel']>
  setStyle: jest.MockedFunction<TextInputBuilder['setStyle']>
  setPlaceholder: jest.MockedFunction<TextInputBuilder['setPlaceholder']>
  setRequired: jest.MockedFunction<TextInputBuilder['setRequired']>
  setMinLength: jest.MockedFunction<TextInputBuilder['setMinLength']>
  setMaxLength: jest.MockedFunction<TextInputBuilder['setMaxLength']>
  setValue: jest.MockedFunction<TextInputBuilder['setValue']>
  toJSON: jest.MockedFunction<TextInputBuilder['toJSON']>
}

export interface MockEmbedBuilder {
  setTitle: jest.MockedFunction<EmbedBuilder['setTitle']>
  setDescription: jest.MockedFunction<EmbedBuilder['setDescription']>
  setColor: jest.MockedFunction<EmbedBuilder['setColor']>
  addFields: jest.MockedFunction<EmbedBuilder['addFields']>
  setFooter: jest.MockedFunction<EmbedBuilder['setFooter']>
  setTimestamp: jest.MockedFunction<EmbedBuilder['setTimestamp']>
  toJSON: jest.MockedFunction<EmbedBuilder['toJSON']>
}

/**
 * Factory functions for creating type-safe mocks
 */
export function createMockAxiosInstance(): MockAxiosInstance {
  const instance = {
    request: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
    head: jest.fn(),
    options: jest.fn(),
    postForm: jest.fn(),
    putForm: jest.fn(),
    patchForm: jest.fn(),
    interceptors: {
      request: {
        use: jest.fn(() => 1),
        eject: jest.fn(),
        clear: jest.fn(),
      },
      response: {
        use: jest.fn(() => 1),
        eject: jest.fn(),
        clear: jest.fn(),
      },
    },
    defaults: {
      headers: {},
      timeout: 30000,
      adapter: jest.fn(),
      transformRequest: [],
      transformResponse: [],
      validateStatus: jest.fn(),
      maxContentLength: -1,
      maxBodyLength: -1,
      transitional: {
        silentJSONParsing: true,
        forcedJSONParsing: true,
        clarifyTimeoutError: false,
      },
    },
    getUri: jest.fn(),

    // Allow dynamic properties for test flexibility
    [Symbol.toStringTag]: 'MockAxiosInstance',
  } as unknown as MockAxiosInstance

  // Make request method delegate to the appropriate HTTP method mock
  instance.request.mockImplementation(config => {
    const method = (config.method || 'get').toLowerCase()
    switch (method) {
      case 'get':
        return instance.get(config.url || '', config)
      case 'post':
        return instance.post(config.url || '', config.data, config)
      case 'put':
        return instance.put(config.url || '', config.data, config)
      case 'delete':
        return instance.delete(config.url || '', config)
      case 'patch':
        return instance.patch(config.url || '', config.data, config)
      case 'head':
        return instance.head(config.url || '', config)
      case 'options':
        return instance.options(config.url || '', config)
      case 'postform':
        return instance.postForm(config.url || '', config.data, config)
      case 'putform':
        return instance.putForm(config.url || '', config.data, config)
      case 'patchform':
        return instance.patchForm(config.url || '', config.data, config)
      default:
        return Promise.reject(new Error(`Unsupported method: ${method}`))
    }
  })

  return instance
}

export function createMockAxiosResponse<T = unknown>(
  data: T,
  status = 200,
): MockAxiosResponse<T> {
  const statusTexts: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  }

  return {
    data,
    status,
    statusText: statusTexts[status] || 'Unknown',
    headers: {
      'content-type': 'application/json',
    },
    config: {
      headers: {},
    },
  }
}

export function createMockRetryService(): MockRetryService {
  return {
    executeWithRetry: jest.fn().mockImplementation(async operation => {
      // Simply execute the operation without retry logic
      return await operation()
    }),
    errorClassifier: createMockErrorClassificationService(),
    defaultConfig: {
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
      logSeverityThreshold: 'LOW',
    },
    shouldLogBasedOnSeverity: jest.fn().mockReturnValue(true),
    calculateDelay: jest.fn().mockReturnValue(1000),
    sleep: jest.fn().mockResolvedValue(undefined),
    executeWithTimeout: jest.fn().mockImplementation(async operation => {
      return await operation()
    }),
  }
}

export function createMockErrorClassificationService(): MockErrorClassificationService {
  return {
    classifyError: jest.fn(),
    shouldRetry: jest.fn(),
    getRetryDelay: jest.fn(),
    logger: createMockLogger(),
  }
}

export function createMockMediaLoggingService(): MockMediaLoggingService {
  return {
    createCorrelationContext: jest.fn(),
    logOperation: jest.fn().mockReturnValue(undefined),
    logComponentInteraction: jest.fn().mockReturnValue(undefined),
    logDiscordError: jest.fn().mockReturnValue(undefined),
    logPerformance: jest.fn().mockReturnValue(undefined),
    logApiCall: jest.fn().mockReturnValue(undefined),
    logError: jest.fn().mockReturnValue(undefined),
    logMediaSearch: jest.fn().mockReturnValue(undefined),
    logMediaRequest: jest.fn().mockReturnValue(undefined),
    getPerformanceMetrics: jest.fn(),
    getApiCallLogs: jest.fn(),
    getMetricsSummary: jest.fn(),
  }
}

export function createMockLogger(): MockLogger {
  return {
    debug: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    verbose: jest.fn(),
    fatal: jest.fn(),
    setContext: jest.fn(),
    localInstance: jest.fn(),
    registerLocalInstanceRef: jest.fn(),
    options: {} as Record<string, unknown>,
  }
}

/**
 * Factory function for MockMediaConfigValidationService
 */
export function createMockMediaConfigValidationService(): MockMediaConfigValidationService {
  return {
    getServiceConfig: jest.fn(),
    getConfiguration: jest.fn(),
    getLastValidation: jest.fn(),
    revalidateConfiguration: jest.fn(),
    areAllServicesValid: jest.fn(),
    getAvailableServices: jest.fn(),
    onModuleInit: jest.fn().mockResolvedValue(undefined),
    validateSonarrConfig: jest.fn(),
    validateRadarrConfig: jest.fn(),
    validateEmbyConfig: jest.fn(),
  }
}

/**
 * Factory function for MockRequestValidationUtils (static methods)
 */
export function createMockRequestValidationUtils(): MockRequestValidationUtils {
  return {
    validateSonarrSeriesRequest: jest.fn(),
    validateRadarrMovieRequest: jest.fn(),
  }
}

/**
 * Create mock SonarrConfig with realistic test data
 */
export function createMockSonarrConfig(
  overrides: Partial<SonarrConfig> = {},
): SonarrConfig {
  return {
    url: 'http://sonarr.test:8989',
    apiKey: 'test-sonarr-api-key-123456',
    timeout: 30000,
    maxRetries: 3,
    isValidated: true,
    httpConfig: {
      maxSockets: 10,
      maxFreeSockets: 5,
      keepAliveTimeout: 5000,
      keepAlive: true,
      connectTimeout: 10000,
      maxContentLength: 10485760,
      maxRedirects: 5,
    },
    versionConfig: {
      supportedVersions: ['3.0.0', '2.0.0'],
      preferredVersion: '3.0.0',
      enableVersionDetection: true,
      fallbackVersion: '3.0.0',
      compatibilityMode: 'fallback' as const,
    },
    ...overrides,
  }
}

/**
 * Create mock RadarrConfig with realistic test data
 */
export function createMockRadarrConfig(
  overrides: Partial<RadarrConfig> = {},
): RadarrConfig {
  return {
    url: 'http://radarr.test:7878',
    apiKey: 'test-radarr-api-key-789012',
    timeout: 30000,
    maxRetries: 3,
    isValidated: true,
    httpConfig: {
      maxSockets: 10,
      maxFreeSockets: 5,
      keepAliveTimeout: 5000,
      keepAlive: true,
      connectTimeout: 10000,
      maxContentLength: 10485760,
      maxRedirects: 5,
    },
    versionConfig: {
      supportedVersions: ['3.0.0', '2.0.0'],
      preferredVersion: '3.0.0',
      enableVersionDetection: true,
      fallbackVersion: '3.0.0',
      compatibilityMode: 'fallback' as const,
    },
    ...overrides,
  }
}

/**
 * Create mock EmbyConfig with realistic test data
 */
export function createMockEmbyConfig(
  overrides: Partial<EmbyConfig> = {},
): EmbyConfig {
  return {
    url: 'http://emby.test:8096',
    apiKey: 'test-emby-api-key-345678',
    userId: '12345678-1234-4678-9012-123456789012',
    timeout: 30000,
    maxRetries: 3,
    isValidated: true,
    httpConfig: {
      maxSockets: 10,
      maxFreeSockets: 5,
      keepAliveTimeout: 5000,
      keepAlive: true,
      connectTimeout: 10000,
      maxContentLength: 10485760,
      maxRedirects: 5,
    },
    versionConfig: {
      supportedVersions: ['4.7.0', '4.6.0', '4.5.0'],
      preferredVersion: '4.7.0',
      enableVersionDetection: true,
      fallbackVersion: '4.7.0',
      compatibilityMode: 'fallback' as const,
    },
    ...overrides,
  }
}

/**
 * Create mock ValidationResult with realistic test data
 */
export function createMockValidationResult(
  overrides: Partial<ValidationResult> = {},
): ValidationResult {
  return {
    isValid: true,
    errors: [],
    warnings: [],
    serviceStatus: {
      sonarr: 'valid',
      radarr: 'valid',
      emby: 'valid',
    },
    ...overrides,
  }
}

export function createMockActionRowBuilder<
  T extends
    | ButtonBuilder
    | StringSelectMenuBuilder
    | TextInputBuilder = ButtonBuilder,
>(): MockActionRowBuilderWithTracking<T> {
  const mock = {
    components: [],
    data: {},
    setId: jest.fn().mockReturnThis(),
    clearId: jest.fn().mockReturnThis(),
    setComponents: jest.fn().mockReturnThis(),
    addComponents: jest.fn().mockImplementation(function (
      this: MockActionRowBuilderWithTracking<T>,
      ...componentsArgs: RestOrArray<T>
    ) {
      // Handle both ...T[] and [T[]] parameter formats
      const components =
        Array.isArray(componentsArgs[0]) && componentsArgs.length === 1
          ? (componentsArgs[0] as T[])
          : (componentsArgs as T[])

      this.components.push(...components)
      return this
    }),
    toJSON: jest.fn().mockImplementation(function (
      this: MockActionRowBuilderWithTracking<T>,
    ) {
      return {
        type: 1, // ComponentType.ActionRow
        components: this.components.map((component: unknown) => {
          if (
            typeof component === 'object' &&
            component !== null &&
            'toJSON' in component &&
            typeof (component as { toJSON: unknown }).toJSON === 'function'
          ) {
            const componentWithToJSON = component as {
              toJSON: () => Record<string, unknown>
            }
            const componentData = componentWithToJSON.toJSON()
            return {
              type: 2, // ComponentType.Button (default, can be overridden by component)
              ...componentData,
            }
          }
          // Fallback for simple data objects
          const componentWithData = component as {
            data?: Record<string, unknown>
          }
          return {
            type: 2,
            ...componentWithData.data,
          }
        }),
      }
    }),
  } as MockActionRowBuilderWithTracking<T>
  return mock
}

export function createMockButtonBuilder(
  initialData: Partial<MockButtonBuilder['data']> = {},
): MockButtonBuilder {
  const mock: MockButtonBuilder = {
    data: { ...initialData },
    setCustomId: jest.fn().mockImplementation(function (
      this: MockButtonBuilder,
      customId: string,
    ) {
      this.data.custom_id = customId
      return this
    }),
    setLabel: jest.fn().mockImplementation(function (
      this: MockButtonBuilder,
      label: string,
    ) {
      this.data.label = label
      return this
    }),
    setStyle: jest.fn().mockImplementation(function (
      this: MockButtonBuilder,
      style: ButtonStyle,
    ) {
      this.data.style = style
      return this
    }),
    setEmoji: jest.fn().mockImplementation(function (
      this: MockButtonBuilder,
      emoji: string | { name?: string; id?: string },
    ) {
      this.data.emoji = typeof emoji === 'string' ? { name: emoji } : emoji
      return this
    }),
    setURL: jest.fn().mockImplementation(function (
      this: MockButtonBuilder,
      url: string,
    ) {
      this.data.url = url
      return this
    }),
    setDisabled: jest.fn().mockImplementation(function (
      this: MockButtonBuilder,
      disabled: boolean,
    ) {
      this.data.disabled = disabled
      return this
    }),
    toJSON: jest.fn().mockImplementation(function (this: MockButtonBuilder) {
      return { ...this.data }
    }),
  }
  return mock
}

export function createMockStringSelectMenuBuilder(
  initialData: Partial<MockStringSelectMenuBuilder['data']> = {},
): MockStringSelectMenuBuilder {
  const mock: MockStringSelectMenuBuilder = {
    data: { options: [], ...initialData },
    setCustomId: jest.fn().mockImplementation(function (
      this: MockStringSelectMenuBuilder,
      customId: string,
    ) {
      this.data.custom_id = customId
      return this
    }),
    setPlaceholder: jest.fn().mockImplementation(function (
      this: MockStringSelectMenuBuilder,
      placeholder: string,
    ) {
      this.data.placeholder = placeholder
      return this
    }),
    setOptions: jest.fn().mockImplementation(function (
      this: MockStringSelectMenuBuilder,
      options: Array<{
        label: string
        value: string
        description?: string
        emoji?: { name?: string; id?: string }
        default?: boolean
      }>,
    ) {
      this.data.options = options
      return this
    }),
    addOptions: jest.fn().mockImplementation(function (
      this: MockStringSelectMenuBuilder,
      ...options: Array<{
        label: string
        value: string
        description?: string
        emoji?: { name?: string; id?: string }
        default?: boolean
      }>
    ) {
      if (!this.data.options) this.data.options = []
      this.data.options.push(...options)
      return this
    }),
    setMaxValues: jest.fn().mockImplementation(function (
      this: MockStringSelectMenuBuilder,
      maxValues: number,
    ) {
      this.data.max_values = maxValues
      return this
    }),
    setMinValues: jest.fn().mockImplementation(function (
      this: MockStringSelectMenuBuilder,
      minValues: number,
    ) {
      this.data.min_values = minValues
      return this
    }),
    setDisabled: jest.fn().mockImplementation(function (
      this: MockStringSelectMenuBuilder,
      disabled: boolean,
    ) {
      this.data.disabled = disabled
      return this
    }),
    toJSON: jest.fn().mockImplementation(function (
      this: MockStringSelectMenuBuilder,
    ) {
      return { ...this.data }
    }),
  }
  return mock
}

export function createMockModalBuilder(
  initialData: Partial<MockModalBuilder['data']> = {},
): MockModalBuilder {
  const mock: MockModalBuilder = {
    data: { components: [], ...initialData },
    setCustomId: jest.fn().mockImplementation(function (
      this: MockModalBuilder,
      customId: string,
    ) {
      this.data.custom_id = customId
      return this
    }),
    setTitle: jest.fn().mockImplementation(function (
      this: MockModalBuilder,
      title: string,
    ) {
      this.data.title = title
      return this
    }),
    addComponents: jest.fn().mockImplementation(function (
      this: MockModalBuilder,
      ...components: Array<Record<string, unknown>>
    ) {
      if (!this.data.components) this.data.components = []
      this.data.components.push(...components)
      return this
    }),
    toJSON: jest.fn().mockImplementation(function (this: MockModalBuilder) {
      return { ...this.data }
    }),
  }
  return mock
}

export function createMockTextInputBuilder(
  initialData: Partial<MockTextInputBuilder['data']> = {},
): MockTextInputBuilder {
  const mock: MockTextInputBuilder = {
    data: { ...initialData },
    setCustomId: jest.fn().mockImplementation(function (
      this: MockTextInputBuilder,
      customId: string,
    ) {
      this.data.custom_id = customId
      return this
    }),
    setLabel: jest.fn().mockImplementation(function (
      this: MockTextInputBuilder,
      label: string,
    ) {
      this.data.label = label
      return this
    }),
    setStyle: jest.fn().mockImplementation(function (
      this: MockTextInputBuilder,
      style: TextInputStyle,
    ) {
      this.data.style = style
      return this
    }),
    setPlaceholder: jest.fn().mockImplementation(function (
      this: MockTextInputBuilder,
      placeholder: string,
    ) {
      this.data.placeholder = placeholder
      return this
    }),
    setRequired: jest.fn().mockImplementation(function (
      this: MockTextInputBuilder,
      required: boolean,
    ) {
      this.data.required = required
      return this
    }),
    setMinLength: jest.fn().mockImplementation(function (
      this: MockTextInputBuilder,
      minLength: number,
    ) {
      this.data.min_length = minLength
      return this
    }),
    setMaxLength: jest.fn().mockImplementation(function (
      this: MockTextInputBuilder,
      maxLength: number,
    ) {
      this.data.max_length = maxLength
      return this
    }),
    setValue: jest.fn().mockImplementation(function (
      this: MockTextInputBuilder,
      value: string,
    ) {
      this.data.value = value
      return this
    }),
    toJSON: jest.fn().mockImplementation(function (this: MockTextInputBuilder) {
      return { ...this.data }
    }),
  }
  return mock
}

export function createMockStringSelectMenuOptionBuilder(
  initialData: Partial<MockStringSelectMenuOptionBuilder['data']> = {
    label: '',
    value: '',
  },
): MockStringSelectMenuOptionBuilder {
  const mock: MockStringSelectMenuOptionBuilder = {
    data: { label: '', value: '', ...initialData },
    setLabel: jest.fn().mockImplementation(function (
      this: MockStringSelectMenuOptionBuilder,
      label: string,
    ) {
      this.data.label = label
      return this
    }),
    setValue: jest.fn().mockImplementation(function (
      this: MockStringSelectMenuOptionBuilder,
      value: string,
    ) {
      this.data.value = value
      return this
    }),
    setDescription: jest.fn().mockImplementation(function (
      this: MockStringSelectMenuOptionBuilder,
      description: string,
    ) {
      this.data.description = description
      return this
    }),
    setEmoji: jest.fn().mockImplementation(function (
      this: MockStringSelectMenuOptionBuilder,
      emoji: string | { name?: string; id?: string },
    ) {
      this.data.emoji = typeof emoji === 'string' ? { name: emoji } : emoji
      return this
    }),
    setDefault: jest.fn().mockImplementation(function (
      this: MockStringSelectMenuOptionBuilder,
      isDefault: boolean,
    ) {
      this.data.default = isDefault
      return this
    }),
    toJSON: jest.fn().mockImplementation(function (
      this: MockStringSelectMenuOptionBuilder,
    ) {
      return { ...this.data }
    }),
  }
  return mock
}

export function createMockEmbedBuilder(): MockEmbedBuilder {
  const mock = {
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
    setTimestamp: jest.fn().mockReturnThis(),
    toJSON: jest.fn(),
  }
  return mock as MockEmbedBuilder
}

/**
 * Branded types for common ID patterns
 */
export type CorrelationId = string & { readonly __brand: 'CorrelationId' }
export type UserId = string & { readonly __brand: 'UserId' }
export type GuildId = string & { readonly __brand: 'GuildId' }
export type ChannelId = string & { readonly __brand: 'ChannelId' }
export type MessageId = string & { readonly __brand: 'MessageId' }
export type ComponentId = string & { readonly __brand: 'ComponentId' }
export type SessionId = string & { readonly __brand: 'SessionId' }

/**
 * Type guards for branded types
 */
export function isCorrelationId(value: string): value is CorrelationId {
  return typeof value === 'string' && value.length > 0
}

export function isUserId(value: string): value is UserId {
  return typeof value === 'string' && /^\d+$/.test(value)
}

export function isGuildId(value: string): value is GuildId {
  return typeof value === 'string' && /^\d+$/.test(value)
}

export function isChannelId(value: string): value is ChannelId {
  return typeof value === 'string' && /^\d+$/.test(value)
}

export function isMessageId(value: string): value is MessageId {
  return typeof value === 'string' && /^\d+$/.test(value)
}

export function isComponentId(value: string): value is ComponentId {
  return typeof value === 'string' && value.length > 0
}

export function isSessionId(value: string): value is SessionId {
  return typeof value === 'string' && value.length > 0
}

/**
 * Factory functions for branded types (for testing purposes)
 */
export function createCorrelationId(
  value = 'test-correlation-id',
): CorrelationId {
  return value as CorrelationId
}

export function createUserId(value = '123456789'): UserId {
  return value as UserId
}

export function createGuildId(value = '987654321'): GuildId {
  return value as GuildId
}

export function createChannelId(value = '456789123'): ChannelId {
  return value as ChannelId
}

export function createMessageId(value = '789123456'): MessageId {
  return value as MessageId
}

export function createComponentId(value = 'test-component-id'): ComponentId {
  return value as ComponentId
}

export function createSessionId(value = 'test-session-id'): SessionId {
  return value as SessionId
}
