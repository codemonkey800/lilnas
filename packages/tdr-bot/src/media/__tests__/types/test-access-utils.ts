/**
 * Type-safe utilities for accessing private methods in tests
 *
 * This module provides type-safe alternatives to 'as any' casting when accessing
 * private methods and properties during testing, maintaining type safety while
 * enabling proper test coverage of internal functionality.
 */

/**
 * Type-safe access to private methods for testing
 */
export type PrivateMethodAccess<T, K extends keyof T> = T & {
  [P in K]: T[P]
}

/**
 * Helper to create type-safe access to private methods
 */
export function createPrivateAccess<T extends object, K extends string>(
  instance: T,
): T & Record<K, unknown> {
  return instance as T & Record<K, unknown>
}

/**
 * Specific type-safe accessors for component services
 */

// Component Factory Service private methods
export interface ComponentFactoryPrivateAccess {
  truncateText(text: string, maxLength: number, suffix?: string): string
  getButtonCustomId(button: unknown): string | undefined
  getButtonUrl(button: unknown): string | undefined
  getButtonLabel(button: unknown): string | undefined
  getButtonEmoji(button: unknown): unknown
  hasCustomIdOrUrl(button: unknown): boolean
  hasLabelOrEmoji(button: unknown): boolean
  getConstraints(): unknown
}

// Select Menu Builder Service private methods
export interface SelectMenuBuilderPrivateAccess {
  createSearchResultOption(result: unknown): unknown
  createQualityProfileOption(profile: unknown): unknown
  createRootFolderOption(folder: unknown): unknown
  createSeasonOption(season: unknown): unknown
  createMediaActionOption(action: string): unknown
  createOptionFromConfig(config: unknown): unknown
  truncateText(text: string, maxLength: number, suffix?: string): string
  truncateCustomId(customId: string): string
  truncatePlaceholder(placeholder: string): string
}

// Modal Builder Service private methods
export interface ModalBuilderPrivateAccess {
  createTextInput(config: unknown): unknown
  truncateText(text: string, maxLength: number, suffix?: string): string
  truncateCustomId(customId: string): string
}

// Discord Error Service private methods
export interface DiscordErrorServicePrivateAccess {
  isDiscordAPIError(error: unknown): boolean
  isInteractionExpired(error: unknown): boolean
  getErrorCode(error: unknown): string
  extractDiscordErrorInfo(error: unknown): unknown
}

// Component State Service private methods
export interface ComponentStateServicePrivateAccess {
  atomicStateTransition<T>(
    sessionId: string,
    operation: string,
    updateFn: (state: unknown) => unknown,
  ): Promise<T>
}

// Media Config Validation Service private methods
export interface MediaConfigValidationServicePrivateAccess {
  isValidUrl(url: string): boolean
  isValidApiKey(apiKey: string): boolean
  isValidEmbyUserId(userId: string): boolean
  validateSonarrConfig(config: unknown): unknown
  validateRadarrConfig(config: unknown): unknown
  validateEmbyConfig(config: unknown): unknown
}

/**
 * Factory functions for creating type-safe private access
 */
export function createComponentFactoryPrivateAccess<T extends object>(
  service: T,
): T & ComponentFactoryPrivateAccess {
  return service as T & ComponentFactoryPrivateAccess
}

export function createSelectMenuBuilderPrivateAccess<T extends object>(
  service: T,
): T & SelectMenuBuilderPrivateAccess {
  return service as T & SelectMenuBuilderPrivateAccess
}

export function createModalBuilderPrivateAccess<T extends object>(
  service: T,
): T & ModalBuilderPrivateAccess {
  return service as T & ModalBuilderPrivateAccess
}

export function createDiscordErrorServicePrivateAccess<T extends object>(
  service: T,
): T & DiscordErrorServicePrivateAccess {
  return service as T & DiscordErrorServicePrivateAccess
}

export function createComponentStateServicePrivateAccess<T extends object>(
  service: T,
): T & ComponentStateServicePrivateAccess {
  return service as T & ComponentStateServicePrivateAccess
}

export function createMediaConfigValidationServicePrivateAccess<
  T extends object,
>(service: T): T & MediaConfigValidationServicePrivateAccess {
  return service as T & MediaConfigValidationServicePrivateAccess
}

/**
 * Generic function to wrap atomic state transitions for testing
 */
export function wrapAtomicStateTransition<T extends object>(
  service: T,
): T & ComponentStateServicePrivateAccess {
  return createComponentStateServicePrivateAccess(service)
}

/**
 * Type guards for testing specific service types
 */
export function hasPrivateMethod<T extends object, K extends string>(
  obj: T,
  methodName: K,
): obj is T & Record<K, (...args: unknown[]) => unknown> {
  return (
    typeof (obj as unknown as Record<string, unknown>)[methodName] ===
    'function'
  )
}

export function hasPrivateProperty<T extends object, K extends string>(
  obj: T,
  propertyName: K,
): obj is T & Record<K, unknown> {
  return propertyName in obj
}
