/**
 * @fileoverview Branded types for preventing ID confusion and enhancing type safety
 *
 * This module provides branded types that prevent mixing different kinds of string/number
 * identifiers at compile time. Each branded type includes factory functions and type guards
 * for safe creation and validation.
 */

/**
 * Base branded type definition - creates a unique type by intersection with a brand property
 */
export type Brand<T, K extends string> = T & { readonly __brand: K }

/**
 * Component State ID - identifies a specific component state entry
 */
export type StateId = Brand<string, 'StateId'>

/**
 * Correlation ID - tracks related operations across system boundaries
 */
export type CorrelationId = Brand<string, 'CorrelationId'>

/**
 * Service ID - identifies different services (Discord, media APIs, etc.)
 */
export type ServiceId = Brand<string, 'ServiceId'>

/**
 * Operation Name - identifies specific operations for retry/logging
 */
export type OperationName = Brand<string, 'OperationName'>

/**
 * Media Item ID - identifies media items (movies, series, etc.)
 */
export type MediaItemId = Brand<string | number, 'MediaItemId'>

/**
 * User ID - Discord user identifier
 */
export type UserId = Brand<string, 'UserId'>

/**
 * Guild ID - Discord guild identifier
 */
export type GuildId = Brand<string, 'GuildId'>

/**
 * Channel ID - Discord channel identifier
 */
export type ChannelId = Brand<string, 'ChannelId'>

/**
 * Component Custom ID - Discord component custom identifier
 */
export type ComponentCustomId = Brand<string, 'ComponentCustomId'>

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Creates a StateId from a string with validation
 */
export function createStateId(value: string): StateId {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('StateId must be a non-empty string')
  }
  return value.trim() as StateId
}

/**
 * Creates a CorrelationId from a string with validation
 */
export function createCorrelationId(value: string): CorrelationId {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('CorrelationId must be a non-empty string')
  }
  return value.trim() as CorrelationId
}

/**
 * Creates a ServiceId from a string with validation
 */
export function createServiceId(value: string): ServiceId {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('ServiceId must be a non-empty string')
  }
  return value.trim() as ServiceId
}

/**
 * Creates an OperationName from a string with validation
 */
export function createOperationName(value: string): OperationName {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('OperationName must be a non-empty string')
  }
  return value.trim() as OperationName
}

/**
 * Creates a MediaItemId from a string or number with validation
 */
export function createMediaItemId(value: string | number): MediaItemId {
  if (typeof value === 'string') {
    if (!value || value.trim().length === 0) {
      throw new Error('MediaItemId string must be non-empty')
    }
    return value.trim() as MediaItemId
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error('MediaItemId number must be a non-negative integer')
    }
    return value as MediaItemId
  }
  throw new Error('MediaItemId must be a string or number')
}

/**
 * Creates a UserId from a string with validation
 */
export function createUserId(value: string): UserId {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('UserId must be a non-empty string')
  }
  return value.trim() as UserId
}

/**
 * Creates a GuildId from a string with validation
 */
export function createGuildId(value: string): GuildId {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('GuildId must be a non-empty string')
  }
  return value.trim() as GuildId
}

/**
 * Creates a ChannelId from a string with validation
 */
export function createChannelId(value: string): ChannelId {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('ChannelId must be a non-empty string')
  }
  return value.trim() as ChannelId
}

/**
 * Creates a ComponentCustomId from a string with validation
 */
export function createComponentCustomId(value: string): ComponentCustomId {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('ComponentCustomId must be a non-empty string')
  }
  // Discord custom IDs have a 100 character limit
  if (value.length > 100) {
    throw new Error('ComponentCustomId must be 100 characters or less')
  }
  return value.trim() as ComponentCustomId
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a StateId
 */
export function isStateId(value: unknown): value is StateId {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Type guard to check if a value is a CorrelationId
 */
export function isCorrelationId(value: unknown): value is CorrelationId {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Type guard to check if a value is a ServiceId
 */
export function isServiceId(value: unknown): value is ServiceId {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Type guard to check if a value is an OperationName
 */
export function isOperationName(value: unknown): value is OperationName {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Type guard to check if a value is a MediaItemId
 */
export function isMediaItemId(value: unknown): value is MediaItemId {
  if (typeof value === 'string') {
    return value.trim().length > 0
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0
  }
  return false
}

/**
 * Type guard to check if a value is a UserId
 */
export function isUserId(value: unknown): value is UserId {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Type guard to check if a value is a GuildId
 */
export function isGuildId(value: unknown): value is GuildId {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Type guard to check if a value is a ChannelId
 */
export function isChannelId(value: unknown): value is ChannelId {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Type guard to check if a value is a ComponentCustomId
 */
export function isComponentCustomId(
  value: unknown,
): value is ComponentCustomId {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= 100
  )
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Extract the underlying type from a branded type
 */
export type Unbrand<T extends Brand<any, any>> =
  T extends Brand<infer U, any> ? U : never

/**
 * Create a map type with branded keys
 */
export type BrandedMap<K extends Brand<string, any>, V> = Map<K, V>

/**
 * Create a record type with branded keys
 */
export type BrandedRecord<K extends Brand<string, any>, V> = Record<
  Unbrand<K>,
  V
>

/**
 * Utility type to check if all values in an object are of a specific branded type
 */
export type AllBranded<
  T extends Record<string, any>,
  B extends Brand<any, any>,
> = {
  [K in keyof T]: T[K] extends B ? T[K] : never
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Well-known service identifiers
 */
export const KNOWN_SERVICES = {
  DISCORD: createServiceId('discord'),
  SONARR: createServiceId('sonarr'),
  RADARR: createServiceId('radarr'),
  EMBY: createServiceId('emby'),
  OPENAI: createServiceId('openai'),
  EQUATION: createServiceId('equation'),
  RETRY: createServiceId('retry'),
} as const

/**
 * Common operation names for consistency
 */
export const OPERATION_NAMES = {
  SEARCH_MEDIA: createOperationName('search_media'),
  ADD_MEDIA: createOperationName('add_media'),
  GET_STATUS: createOperationName('get_status'),
  GET_QUEUE: createOperationName('get_queue'),
  AUTHENTICATE: createOperationName('authenticate'),
  RENDER_EQUATION: createOperationName('render_equation'),
  LLM_REQUEST: createOperationName('llm_request'),
} as const
