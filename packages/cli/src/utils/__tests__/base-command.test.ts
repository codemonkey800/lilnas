import { beforeAll, describe, expect, it } from '@jest/globals'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharedFlags: any

beforeAll(async () => {
  const module = await import('../base-command.js')
  sharedFlags = module.sharedFlags
})

describe('base-command', () => {
  describe('sharedFlags', () => {
    it('should have apps flag with correct configuration', () => {
      expect(sharedFlags.apps).toBeDefined()
      expect(sharedFlags.apps.char).toBe('a')
      expect(sharedFlags.apps.exclusive).toContain('services')
    })

    it('should have services flag with correct configuration', () => {
      expect(sharedFlags.services).toBeDefined()
      expect(sharedFlags.services.char).toBe('s')
      expect(sharedFlags.services.exclusive).toContain('apps')
    })

    it('should have correct descriptions', () => {
      expect(sharedFlags.apps.description).toContain('package services')
      expect(sharedFlags.services.description).toContain(
        'infrastructure services',
      )
    })
  })
})
