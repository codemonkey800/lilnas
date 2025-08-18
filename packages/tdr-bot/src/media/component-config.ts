/**
 * Centralized configuration for Discord component lifecycle management
 * Consolidates all component-related timeouts, limits, and settings
 */

export const COMPONENT_CONFIG = {
  // Core timing configuration
  LIFETIME_MS: 15 * 60 * 1000, // 15 minutes - Discord interaction lifetime
  WARNING_OFFSET_MS: 2 * 60 * 1000, // 2 minutes before expiration warning
  CLEANUP_INTERVAL_MS: 60 * 1000, // 1 minute cleanup interval

  // Component limits
  MAX_CONCURRENT_PER_USER: 5, // Maximum active components per user
  MAX_CONCURRENT_GLOBAL: 10, // Maximum total active components

  // Cleanup settings
  GRACE_PERIOD_MS: 30 * 1000, // 30 seconds grace period for cleanup
} as const

/**
 * Component lifecycle states - simplified from multiple boolean flags
 */
export enum ComponentLifecycleState {
  ACTIVE = 'active', // Component is active and can receive interactions
  WARNING = 'warning', // Warning sent, expires soon
  EXPIRED = 'expired', // Timed out, needs cleanup
  CLEANED = 'cleaned', // Removed from memory
}

/**
 * Cleanup trigger reasons for tracking and debugging
 */
export type CleanupReason =
  | 'timeout'
  | 'manual'
  | 'collector_end'
  | 'user_limit'
  | 'system_shutdown'

/**
 * Simplified component state configuration
 */
export interface ComponentConfig {
  readonly lifetimeMs: number
  readonly warningOffsetMs: number
  readonly maxConcurrentPerUser: number
  readonly maxConcurrentGlobal: number
  readonly cleanupIntervalMs: number
}

/**
 * Default component configuration instance
 */
export const defaultComponentConfig: ComponentConfig = {
  lifetimeMs: COMPONENT_CONFIG.LIFETIME_MS,
  warningOffsetMs: COMPONENT_CONFIG.WARNING_OFFSET_MS,
  maxConcurrentPerUser: COMPONENT_CONFIG.MAX_CONCURRENT_PER_USER,
  maxConcurrentGlobal: COMPONENT_CONFIG.MAX_CONCURRENT_GLOBAL,
  cleanupIntervalMs: COMPONENT_CONFIG.CLEANUP_INTERVAL_MS,
}
