import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createTestPartnership,
  createTestTemplate,
  createTestTemplateQuestion,
  createTestUser,
  mockAuthAs,
  truncateAll,
} from './helpers'

// Mock auth before importing actions (setup file mocks src/db and next/cache)
vi.mock('src/auth', () => ({
  auth: vi.fn(),
}))

// Import queries under test (these resolve to the mocked db/auth)
const { getTemplates, getTemplate } = await import(
  'src/app/(app)/templates/queries'
)

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('template queries', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  // -----------------------------------------------------------------------
  // getTemplates
  // -----------------------------------------------------------------------

  describe('getTemplates', () => {
    it('returns system templates for any authenticated user', async () => {
      const user = await createTestUser()
      const tpl = await createTestTemplate(null, {
        name: 'Weekly Check-in',
        isSystem: true,
      })
      await createTestTemplateQuestion(tpl.id, {
        questionText: 'How are you?',
        orderIndex: 0,
      })
      await mockAuthAs(user.id)

      const result = await getTemplates()

      expect(result).toHaveLength(1)
      expect(result![0]).toEqual(
        expect.objectContaining({
          id: tpl.id,
          name: 'Weekly Check-in',
          isSystem: true,
          questionCount: 1,
        }),
      )
    })

    it('returns custom templates for partnership members', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const tpl = await createTestTemplate(partnership.id, {
        name: 'Our Template',
        createdById: alice.id,
      })
      await createTestTemplateQuestion(tpl.id)
      await mockAuthAs(alice.id)

      const result = await getTemplates()

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: tpl.id,
            name: 'Our Template',
            isSystem: false,
          }),
        ]),
      )
    })

    it('does not return other partnerships custom templates', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const charlie = await createTestUser()
      const dave = await createTestUser()
      await createTestPartnership(alice.id, bob.id, 'accepted')
      const otherPartnership = await createTestPartnership(
        charlie.id,
        dave.id,
        'accepted',
      )
      await createTestTemplate(otherPartnership.id, {
        name: 'Their Template',
        createdById: charlie.id,
      })
      await mockAuthAs(alice.id)

      const result = await getTemplates()

      const names = result?.map(t => t.name) ?? []
      expect(names).not.toContain('Their Template')
    })

    it('returns null for unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await getTemplates()

      expect(result).toBeNull()
    })

    it('includes question count per template', async () => {
      const user = await createTestUser()
      const tpl = await createTestTemplate(null, {
        name: 'Multi-question',
        isSystem: true,
      })
      await createTestTemplateQuestion(tpl.id, { orderIndex: 0 })
      await createTestTemplateQuestion(tpl.id, {
        questionText: 'Second?',
        orderIndex: 1,
      })
      await createTestTemplateQuestion(tpl.id, {
        questionText: 'Third?',
        orderIndex: 2,
      })
      await mockAuthAs(user.id)

      const result = await getTemplates()

      const found = result?.find(t => t.id === tpl.id)
      expect(found?.questionCount).toBe(3)
    })
  })

  // -----------------------------------------------------------------------
  // getTemplate
  // -----------------------------------------------------------------------

  describe('getTemplate', () => {
    it('returns system template with ordered questions for any authenticated user', async () => {
      const user = await createTestUser()
      const tpl = await createTestTemplate(null, {
        name: 'System Template',
        isSystem: true,
      })
      await createTestTemplateQuestion(tpl.id, {
        questionText: 'Second?',
        orderIndex: 1,
      })
      await createTestTemplateQuestion(tpl.id, {
        questionText: 'First?',
        orderIndex: 0,
      })
      await mockAuthAs(user.id)

      const result = await getTemplate(tpl.id)

      expect(result).not.toBeNull()
      expect(result!.name).toBe('System Template')
      expect(result!.isSystem).toBe(true)
      expect(result!.questions).toHaveLength(2)
      expect(result!.questions[0]!.questionText).toBe('First?')
      expect(result!.questions[1]!.questionText).toBe('Second?')
    })

    it('returns custom template for partnership member', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const tpl = await createTestTemplate(partnership.id, {
        name: 'Custom',
        createdById: alice.id,
      })
      await createTestTemplateQuestion(tpl.id)
      await mockAuthAs(bob.id)

      const result = await getTemplate(tpl.id)

      expect(result).not.toBeNull()
      expect(result!.name).toBe('Custom')
    })

    it('rejects access to another partnerships custom template', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const charlie = await createTestUser()
      const dave = await createTestUser()
      await createTestPartnership(alice.id, bob.id, 'accepted')
      const otherPartnership = await createTestPartnership(
        charlie.id,
        dave.id,
        'accepted',
      )
      const tpl = await createTestTemplate(otherPartnership.id, {
        name: 'Private',
        createdById: charlie.id,
      })
      await mockAuthAs(alice.id)

      const result = await getTemplate(tpl.id)

      expect(result).toBeNull()
    })

    it('returns null for non-existent template', async () => {
      const user = await createTestUser()
      await mockAuthAs(user.id)

      const result = await getTemplate('non-existent-id')

      expect(result).toBeNull()
    })

    it('returns null for unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await getTemplate('any-id')

      expect(result).toBeNull()
    })
  })
})
