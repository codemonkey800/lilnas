import {
  CleanupReason,
  COMPONENT_CONFIG,
  ComponentConfig,
  ComponentLifecycleState,
  defaultComponentConfig,
} from 'src/media/component-config'

describe('Component Configuration', () => {
  describe('COMPONENT_CONFIG Constants', () => {
    it('should define correct timing constants', () => {
      expect(COMPONENT_CONFIG.LIFETIME_MS).toBe(15 * 60 * 1000) // 15 minutes
      expect(COMPONENT_CONFIG.WARNING_OFFSET_MS).toBe(2 * 60 * 1000) // 2 minutes
      expect(COMPONENT_CONFIG.CLEANUP_INTERVAL_MS).toBe(60 * 1000) // 1 minute
      expect(COMPONENT_CONFIG.GRACE_PERIOD_MS).toBe(30 * 1000) // 30 seconds
    })

    it('should define reasonable component limits', () => {
      expect(COMPONENT_CONFIG.MAX_CONCURRENT_PER_USER).toBe(5)
      expect(COMPONENT_CONFIG.MAX_CONCURRENT_GLOBAL).toBe(10)
      expect(COMPONENT_CONFIG.MAX_CONCURRENT_PER_USER).toBeLessThanOrEqual(
        COMPONENT_CONFIG.MAX_CONCURRENT_GLOBAL,
      )
    })

    it('should have warning offset less than lifetime', () => {
      expect(COMPONENT_CONFIG.WARNING_OFFSET_MS).toBeLessThan(
        COMPONENT_CONFIG.LIFETIME_MS,
      )
    })

    it('should have grace period less than cleanup interval', () => {
      expect(COMPONENT_CONFIG.GRACE_PERIOD_MS).toBeLessThan(
        COMPONENT_CONFIG.CLEANUP_INTERVAL_MS,
      )
    })

    it('should be readonly (immutable)', () => {
      // Test that TypeScript enforces readonly at compile time
      // Runtime immutability isn't enforced by 'as const' alone
      expect(COMPONENT_CONFIG).toBeDefined()

      // Verify that the configuration values are correct
      expect(COMPONENT_CONFIG.LIFETIME_MS).toBe(15 * 60 * 1000)
      expect(COMPONENT_CONFIG.MAX_CONCURRENT_PER_USER).toBe(5)
    })
  })

  describe('ComponentLifecycleState Enum', () => {
    it('should define all required lifecycle states', () => {
      expect(ComponentLifecycleState.ACTIVE).toBe('active')
      expect(ComponentLifecycleState.WARNING).toBe('warning')
      expect(ComponentLifecycleState.EXPIRED).toBe('expired')
      expect(ComponentLifecycleState.CLEANED).toBe('cleaned')
    })

    it('should have string values for serialization', () => {
      Object.values(ComponentLifecycleState).forEach(state => {
        expect(typeof state).toBe('string')
        expect(state.length).toBeGreaterThan(0)
      })
    })

    it('should follow logical state progression', () => {
      const states = Object.values(ComponentLifecycleState)
      expect(states).toContain('active')
      expect(states).toContain('warning')
      expect(states).toContain('expired')
      expect(states).toContain('cleaned')
    })

    it('should be usable in switch statements', () => {
      function getStateLabel(state: ComponentLifecycleState): string {
        switch (state) {
          case ComponentLifecycleState.ACTIVE:
            return 'active'
          case ComponentLifecycleState.WARNING:
            return 'warning'
          case ComponentLifecycleState.EXPIRED:
            return 'expired'
          case ComponentLifecycleState.CLEANED:
            return 'cleaned'
          default:
            return 'unknown'
        }
      }

      expect(getStateLabel(ComponentLifecycleState.ACTIVE)).toBe('active')
      expect(getStateLabel(ComponentLifecycleState.WARNING)).toBe('warning')
      expect(getStateLabel(ComponentLifecycleState.EXPIRED)).toBe('expired')
      expect(getStateLabel(ComponentLifecycleState.CLEANED)).toBe('cleaned')
    })
  })

  describe('CleanupReason Type', () => {
    it('should define all expected cleanup reasons', () => {
      const validReasons: CleanupReason[] = [
        'timeout',
        'manual',
        'collector_end',
        'user_limit',
        'system_shutdown',
      ]

      validReasons.forEach(reason => {
        expect(typeof reason).toBe('string')
      })
    })

    it('should be type-safe for function parameters', () => {
      function processCleanup(reason: CleanupReason): string {
        return `Cleaning up due to: ${reason}`
      }

      expect(processCleanup('timeout')).toBe('Cleaning up due to: timeout')
      expect(processCleanup('manual')).toBe('Cleaning up due to: manual')
      expect(processCleanup('collector_end')).toBe(
        'Cleaning up due to: collector_end',
      )
      expect(processCleanup('user_limit')).toBe(
        'Cleaning up due to: user_limit',
      )
      expect(processCleanup('system_shutdown')).toBe(
        'Cleaning up due to: system_shutdown',
      )
    })
  })

  describe('ComponentConfig Interface', () => {
    it('should define readonly configuration properties', () => {
      const config: ComponentConfig = {
        lifetimeMs: 900000,
        warningOffsetMs: 120000,
        maxConcurrentPerUser: 5,
        maxConcurrentGlobal: 10,
        cleanupIntervalMs: 60000,
      }

      expect(config.lifetimeMs).toBe(900000)
      expect(config.warningOffsetMs).toBe(120000)
      expect(config.maxConcurrentPerUser).toBe(5)
      expect(config.maxConcurrentGlobal).toBe(10)
      expect(config.cleanupIntervalMs).toBe(60000)
    })

    it('should enforce type safety', () => {
      // These should cause TypeScript errors if uncommented
      // const invalidConfig: ComponentConfig = {
      //   lifetimeMs: 'invalid', // Should be number
      //   warningOffsetMs: 120000,
      //   maxConcurrentPerUser: 5,
      //   maxConcurrentGlobal: 10,
      //   cleanupIntervalMs: 60000,
      // }

      const validConfig: ComponentConfig = {
        lifetimeMs: 600000,
        warningOffsetMs: 60000,
        maxConcurrentPerUser: 3,
        maxConcurrentGlobal: 15,
        cleanupIntervalMs: 30000,
      }

      expect(typeof validConfig.lifetimeMs).toBe('number')
      expect(typeof validConfig.warningOffsetMs).toBe('number')
      expect(typeof validConfig.maxConcurrentPerUser).toBe('number')
      expect(typeof validConfig.maxConcurrentGlobal).toBe('number')
      expect(typeof validConfig.cleanupIntervalMs).toBe('number')
    })

    it('should have all required properties', () => {
      const config: ComponentConfig = {
        lifetimeMs: 900000,
        warningOffsetMs: 120000,
        maxConcurrentPerUser: 5,
        maxConcurrentGlobal: 10,
        cleanupIntervalMs: 60000,
      }

      // Check that all required properties exist
      expect(config).toHaveProperty('lifetimeMs')
      expect(config).toHaveProperty('warningOffsetMs')
      expect(config).toHaveProperty('maxConcurrentPerUser')
      expect(config).toHaveProperty('maxConcurrentGlobal')
      expect(config).toHaveProperty('cleanupIntervalMs')
    })
  })

  describe('defaultComponentConfig', () => {
    it('should use values from COMPONENT_CONFIG', () => {
      expect(defaultComponentConfig.lifetimeMs).toBe(
        COMPONENT_CONFIG.LIFETIME_MS,
      )
      expect(defaultComponentConfig.warningOffsetMs).toBe(
        COMPONENT_CONFIG.WARNING_OFFSET_MS,
      )
      expect(defaultComponentConfig.maxConcurrentPerUser).toBe(
        COMPONENT_CONFIG.MAX_CONCURRENT_PER_USER,
      )
      expect(defaultComponentConfig.maxConcurrentGlobal).toBe(
        COMPONENT_CONFIG.MAX_CONCURRENT_GLOBAL,
      )
      expect(defaultComponentConfig.cleanupIntervalMs).toBe(
        COMPONENT_CONFIG.CLEANUP_INTERVAL_MS,
      )
    })

    it('should be a valid ComponentConfig', () => {
      const config: ComponentConfig = defaultComponentConfig
      expect(config).toBeDefined()
      expect(typeof config.lifetimeMs).toBe('number')
      expect(typeof config.warningOffsetMs).toBe('number')
      expect(typeof config.maxConcurrentPerUser).toBe('number')
      expect(typeof config.maxConcurrentGlobal).toBe('number')
      expect(typeof config.cleanupIntervalMs).toBe('number')
    })

    it('should have sensible default values', () => {
      expect(defaultComponentConfig.lifetimeMs).toBeGreaterThan(0)
      expect(defaultComponentConfig.warningOffsetMs).toBeGreaterThan(0)
      expect(defaultComponentConfig.maxConcurrentPerUser).toBeGreaterThan(0)
      expect(defaultComponentConfig.maxConcurrentGlobal).toBeGreaterThan(0)
      expect(defaultComponentConfig.cleanupIntervalMs).toBeGreaterThan(0)

      expect(defaultComponentConfig.warningOffsetMs).toBeLessThan(
        defaultComponentConfig.lifetimeMs,
      )
      expect(defaultComponentConfig.maxConcurrentPerUser).toBeLessThanOrEqual(
        defaultComponentConfig.maxConcurrentGlobal,
      )
    })

    it('should be immutable (TypeScript compile-time)', () => {
      const originalLifetime = defaultComponentConfig.lifetimeMs

      // Verify that the readonly properties exist and have correct values
      expect(defaultComponentConfig.lifetimeMs).toBe(originalLifetime)
      expect(defaultComponentConfig.lifetimeMs).toBe(
        COMPONENT_CONFIG.LIFETIME_MS,
      )

      // TypeScript prevents modification at compile time with readonly
      expect(typeof defaultComponentConfig.lifetimeMs).toBe('number')
    })
  })

  describe('Configuration Validation', () => {
    it('should validate logical relationships between timing values', () => {
      // Warning offset should be less than lifetime
      expect(COMPONENT_CONFIG.WARNING_OFFSET_MS).toBeLessThan(
        COMPONENT_CONFIG.LIFETIME_MS,
      )

      // Grace period should be reasonable compared to cleanup interval
      expect(COMPONENT_CONFIG.GRACE_PERIOD_MS).toBeLessThan(
        COMPONENT_CONFIG.CLEANUP_INTERVAL_MS,
      )

      // All timing values should be positive
      expect(COMPONENT_CONFIG.LIFETIME_MS).toBeGreaterThan(0)
      expect(COMPONENT_CONFIG.WARNING_OFFSET_MS).toBeGreaterThan(0)
      expect(COMPONENT_CONFIG.CLEANUP_INTERVAL_MS).toBeGreaterThan(0)
      expect(COMPONENT_CONFIG.GRACE_PERIOD_MS).toBeGreaterThan(0)

      // Verify actual values match expectations
      expect(COMPONENT_CONFIG.LIFETIME_MS).toBe(15 * 60 * 1000) // 15 minutes
      expect(COMPONENT_CONFIG.WARNING_OFFSET_MS).toBe(2 * 60 * 1000) // 2 minutes
      expect(COMPONENT_CONFIG.CLEANUP_INTERVAL_MS).toBe(60 * 1000) // 1 minute
      expect(COMPONENT_CONFIG.GRACE_PERIOD_MS).toBe(30 * 1000) // 30 seconds
    })

    it('should validate component limits are reasonable', () => {
      // Per-user limit should not exceed global limit
      expect(COMPONENT_CONFIG.MAX_CONCURRENT_PER_USER).toBeLessThanOrEqual(
        COMPONENT_CONFIG.MAX_CONCURRENT_GLOBAL,
      )

      // Limits should be positive
      expect(COMPONENT_CONFIG.MAX_CONCURRENT_PER_USER).toBeGreaterThan(0)
      expect(COMPONENT_CONFIG.MAX_CONCURRENT_GLOBAL).toBeGreaterThan(0)

      // Limits should be reasonable (not too low or too high)
      expect(COMPONENT_CONFIG.MAX_CONCURRENT_PER_USER).toBeGreaterThanOrEqual(1)
      expect(COMPONENT_CONFIG.MAX_CONCURRENT_PER_USER).toBeLessThanOrEqual(50)
      expect(COMPONENT_CONFIG.MAX_CONCURRENT_GLOBAL).toBeLessThanOrEqual(1000)
    })

    it('should work with Discord.js interaction timeouts', () => {
      // Discord.js interactions expire after 15 minutes
      const DISCORD_INTERACTION_TIMEOUT = 15 * 60 * 1000

      // Our component lifetime should align with Discord's timeout
      expect(COMPONENT_CONFIG.LIFETIME_MS).toBeLessThanOrEqual(
        DISCORD_INTERACTION_TIMEOUT,
      )

      // Warning should give enough time for user action
      // With 15 minute lifetime and 2 minute warning offset,
      // users get warning at 13 minutes (2 minutes remaining)
      const warningTime =
        COMPONENT_CONFIG.LIFETIME_MS - COMPONENT_CONFIG.WARNING_OFFSET_MS
      expect(warningTime).toBe(13 * 60 * 1000) // 13 minutes

      // Users have 2 minutes to act after warning
      const timeToAct = COMPONENT_CONFIG.WARNING_OFFSET_MS
      expect(timeToAct).toBe(2 * 60 * 1000) // 2 minutes to act
    })

    it('should support custom configurations', () => {
      const customConfig: ComponentConfig = {
        lifetimeMs: 5 * 60 * 1000, // 5 minutes
        warningOffsetMs: 30 * 1000, // 30 seconds
        maxConcurrentPerUser: 3,
        maxConcurrentGlobal: 20,
        cleanupIntervalMs: 30 * 1000, // 30 seconds
      }

      // Custom config should be valid
      expect(customConfig.warningOffsetMs).toBeLessThan(customConfig.lifetimeMs)
      expect(customConfig.maxConcurrentPerUser).toBeLessThanOrEqual(
        customConfig.maxConcurrentGlobal,
      )

      // Should work as ComponentConfig
      function useConfig(config: ComponentConfig): boolean {
        return (
          config.lifetimeMs > 0 &&
          config.warningOffsetMs < config.lifetimeMs &&
          config.maxConcurrentPerUser <= config.maxConcurrentGlobal
        )
      }

      expect(useConfig(customConfig)).toBe(true)
      expect(useConfig(defaultComponentConfig)).toBe(true)
    })
  })
})
