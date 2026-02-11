import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_QUESTIONS } from 'src/app/(app)/templates/constants'

import {
  createTestPartnership,
  createTestTemplate,
  createTestTemplateQuestion,
  createTestUser,
  getTemplate,
  getTemplateQuestions,
  mockAuthAs,
  truncateAll,
} from './helpers'

// Mock auth before importing actions (setup file mocks src/db and next/cache)
vi.mock('src/auth', () => ({
  auth: vi.fn(),
}))

// Import actions under test (these resolve to the mocked db/auth)
const { createTemplate, updateTemplate, deleteTemplate, duplicateTemplate } =
  await import('src/app/(app)/templates/actions')

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('template actions', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  // -----------------------------------------------------------------------
  // createTemplate
  // -----------------------------------------------------------------------

  describe('createTemplate', () => {
    it('creates template with questions for partnered user', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      await mockAuthAs(alice.id)

      const result = await createTemplate({
        name: 'Weekly Sync',
        description: 'Our weekly check-in',
        questions: [
          { questionText: 'How are you?' },
          { questionText: 'What do you need?', isRequired: false },
        ],
      })

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          templateId: expect.any(String),
        }),
      )

      if (result.success) {
        const tpl = await getTemplate(result.templateId!)
        expect(tpl).toEqual(
          expect.objectContaining({
            name: 'Weekly Sync',
            description: 'Our weekly check-in',
            isSystem: false,
            partnershipId: partnership.id,
            createdById: alice.id,
          }),
        )

        const questions = await getTemplateQuestions(result.templateId!)
        expect(questions).toHaveLength(2)
        expect(questions[0]!.questionText).toBe('How are you?')
        expect(questions[0]!.isRequired).toBe(true)
        expect(questions[0]!.orderIndex).toBe(0)
        expect(questions[1]!.questionText).toBe('What do you need?')
        expect(questions[1]!.isRequired).toBe(false)
        expect(questions[1]!.orderIndex).toBe(1)
      }
    })

    it('rejects unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await createTemplate({
        name: 'Test',
        questions: [{ questionText: 'Q?' }],
      })

      expect(result).toEqual({
        success: false,
        error: 'You must be logged in.',
      })
    })

    it('rejects user without active partnership', async () => {
      const user = await createTestUser()
      await mockAuthAs(user.id)

      const result = await createTemplate({
        name: 'Test',
        questions: [{ questionText: 'Q?' }],
      })

      expect(result).toEqual({
        success: false,
        error: 'You must have an active partnership to create templates.',
      })
    })

    it('rejects empty name', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      await createTestPartnership(alice.id, bob.id, 'accepted')
      await mockAuthAs(alice.id)

      const result = await createTemplate({
        name: '   ',
        questions: [{ questionText: 'Q?' }],
      })

      expect(result).toEqual({
        success: false,
        error: 'Template name must be between 1 and 100 characters.',
      })
    })

    it('rejects name longer than 100 characters', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      await createTestPartnership(alice.id, bob.id, 'accepted')
      await mockAuthAs(alice.id)

      const result = await createTemplate({
        name: 'x'.repeat(101),
        questions: [{ questionText: 'Q?' }],
      })

      expect(result).toEqual({
        success: false,
        error: 'Template name must be between 1 and 100 characters.',
      })
    })

    it('rejects zero questions', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      await createTestPartnership(alice.id, bob.id, 'accepted')
      await mockAuthAs(alice.id)

      const result = await createTemplate({
        name: 'Empty Template',
        questions: [],
      })

      expect(result).toEqual({
        success: false,
        error: 'A template must have at least one question.',
      })
    })

    it('rejects question text longer than 500 characters', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      await createTestPartnership(alice.id, bob.id, 'accepted')
      await mockAuthAs(alice.id)

      const result = await createTemplate({
        name: 'Long Question',
        questions: [{ questionText: 'q'.repeat(501) }],
      })

      expect(result).toEqual({
        success: false,
        error: 'Each question must be between 1 and 500 characters.',
      })
    })

    it('rejects empty question text', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      await createTestPartnership(alice.id, bob.id, 'accepted')
      await mockAuthAs(alice.id)

      const result = await createTemplate({
        name: 'Bad Question',
        questions: [{ questionText: '   ' }],
      })

      expect(result).toEqual({
        success: false,
        error: 'Each question must be between 1 and 500 characters.',
      })
    })

    it(`rejects more than ${MAX_QUESTIONS} questions`, async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      await createTestPartnership(alice.id, bob.id, 'accepted')
      await mockAuthAs(alice.id)

      const questions = Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => ({
        questionText: `Question ${i + 1}?`,
      }))

      const result = await createTemplate({
        name: 'Too Many Questions',
        questions,
      })

      expect(result).toEqual({
        success: false,
        error: `A template can have at most ${MAX_QUESTIONS} questions.`,
      })
    })

    it('assigns sequential orderIndex to questions', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      await createTestPartnership(alice.id, bob.id, 'accepted')
      await mockAuthAs(alice.id)

      const result = await createTemplate({
        name: 'Ordered',
        questions: [
          { questionText: 'First?' },
          { questionText: 'Second?' },
          { questionText: 'Third?' },
        ],
      })

      expect(result.success).toBe(true)
      if (result.success) {
        const questions = await getTemplateQuestions(result.templateId!)
        expect(questions.map(q => q.orderIndex)).toEqual([0, 1, 2])
        expect(questions.map(q => q.questionText)).toEqual([
          'First?',
          'Second?',
          'Third?',
        ])
      }
    })

    it('trims name and question text', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      await createTestPartnership(alice.id, bob.id, 'accepted')
      await mockAuthAs(alice.id)

      const result = await createTemplate({
        name: '  Trimmed Name  ',
        description: '  Trimmed Desc  ',
        questions: [{ questionText: '  Trimmed Q?  ' }],
      })

      expect(result.success).toBe(true)
      if (result.success) {
        const tpl = await getTemplate(result.templateId!)
        expect(tpl?.name).toBe('Trimmed Name')
        expect(tpl?.description).toBe('Trimmed Desc')

        const questions = await getTemplateQuestions(result.templateId!)
        expect(questions[0]!.questionText).toBe('Trimmed Q?')
      }
    })
  })

  // -----------------------------------------------------------------------
  // updateTemplate
  // -----------------------------------------------------------------------

  describe('updateTemplate', () => {
    it('updates name and description', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const tpl = await createTestTemplate(partnership.id, {
        name: 'Original',
        description: 'Original desc',
        createdById: alice.id,
      })
      await createTestTemplateQuestion(tpl.id)
      await mockAuthAs(alice.id)

      const result = await updateTemplate(tpl.id, {
        name: 'Updated',
        description: 'Updated desc',
      })

      expect(result).toEqual(
        expect.objectContaining({ success: true, templateId: tpl.id }),
      )

      const updated = await getTemplate(tpl.id)
      expect(updated?.name).toBe('Updated')
      expect(updated?.description).toBe('Updated desc')
    })

    it('replaces questions when provided', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const tpl = await createTestTemplate(partnership.id, {
        name: 'Template',
        createdById: alice.id,
      })
      await createTestTemplateQuestion(tpl.id, {
        questionText: 'Old Q?',
        orderIndex: 0,
      })
      await mockAuthAs(alice.id)

      const result = await updateTemplate(tpl.id, {
        questions: [
          { questionText: 'New Q1?' },
          { questionText: 'New Q2?', isRequired: false },
        ],
      })

      expect(result.success).toBe(true)

      const questions = await getTemplateQuestions(tpl.id)
      expect(questions).toHaveLength(2)
      expect(questions[0]!.questionText).toBe('New Q1?')
      expect(questions[0]!.orderIndex).toBe(0)
      expect(questions[1]!.questionText).toBe('New Q2?')
      expect(questions[1]!.isRequired).toBe(false)
      expect(questions[1]!.orderIndex).toBe(1)
    })

    it('rejects system template update', async () => {
      const user = await createTestUser()
      const tpl = await createTestTemplate(null, {
        name: 'System',
        isSystem: true,
      })
      await mockAuthAs(user.id)

      const result = await updateTemplate(tpl.id, { name: 'Hacked' })

      expect(result).toEqual({
        success: false,
        error: 'System templates cannot be edited.',
      })
    })

    it('rejects non-member of owning partnership', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const outsider = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const tpl = await createTestTemplate(partnership.id, {
        name: 'Private',
        createdById: alice.id,
      })
      await mockAuthAs(outsider.id)

      const result = await updateTemplate(tpl.id, { name: 'Hacked' })

      expect(result).toEqual({
        success: false,
        error: 'You are not a member of this partnership.',
      })
    })

    it('rejects unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await updateTemplate('some-id', { name: 'Test' })

      expect(result).toEqual({
        success: false,
        error: 'You must be logged in.',
      })
    })

    it('rejects empty name', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const tpl = await createTestTemplate(partnership.id, {
        name: 'Template',
        createdById: alice.id,
      })
      await mockAuthAs(alice.id)

      const result = await updateTemplate(tpl.id, { name: '   ' })

      expect(result).toEqual({
        success: false,
        error: 'Template name must be between 1 and 100 characters.',
      })
    })

    it('rejects name longer than 100 characters', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const tpl = await createTestTemplate(partnership.id, {
        name: 'Template',
        createdById: alice.id,
      })
      await mockAuthAs(alice.id)

      const result = await updateTemplate(tpl.id, { name: 'x'.repeat(101) })

      expect(result).toEqual({
        success: false,
        error: 'Template name must be between 1 and 100 characters.',
      })
    })

    it('rejects zero questions when questions are provided', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const tpl = await createTestTemplate(partnership.id, {
        name: 'Template',
        createdById: alice.id,
      })
      await createTestTemplateQuestion(tpl.id)
      await mockAuthAs(alice.id)

      const result = await updateTemplate(tpl.id, { questions: [] })

      expect(result).toEqual({
        success: false,
        error: 'A template must have at least one question.',
      })
    })

    it(`rejects more than ${MAX_QUESTIONS} questions`, async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const tpl = await createTestTemplate(partnership.id, {
        name: 'Template',
        createdById: alice.id,
      })
      await createTestTemplateQuestion(tpl.id)
      await mockAuthAs(alice.id)

      const questions = Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => ({
        questionText: `Question ${i + 1}?`,
      }))

      const result = await updateTemplate(tpl.id, { questions })

      expect(result).toEqual({
        success: false,
        error: `A template can have at most ${MAX_QUESTIONS} questions.`,
      })
    })

    it('rejects non-existent template', async () => {
      const user = await createTestUser()
      await mockAuthAs(user.id)

      const result = await updateTemplate('non-existent-id', { name: 'Test' })

      expect(result).toEqual({
        success: false,
        error: 'Template not found.',
      })
    })

    it('allows partner to update the other partners template', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const tpl = await createTestTemplate(partnership.id, {
        name: 'Alice Template',
        createdById: alice.id,
      })
      await createTestTemplateQuestion(tpl.id)
      await mockAuthAs(bob.id)

      const result = await updateTemplate(tpl.id, { name: 'Bob Updated' })

      expect(result.success).toBe(true)

      const updated = await getTemplate(tpl.id)
      expect(updated?.name).toBe('Bob Updated')
    })
  })

  // -----------------------------------------------------------------------
  // deleteTemplate
  // -----------------------------------------------------------------------

  describe('deleteTemplate', () => {
    it('deletes custom template and its questions', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const tpl = await createTestTemplate(partnership.id, {
        name: 'Deletable',
        createdById: alice.id,
      })
      await createTestTemplateQuestion(tpl.id, { orderIndex: 0 })
      await createTestTemplateQuestion(tpl.id, {
        questionText: 'Q2?',
        orderIndex: 1,
      })
      await mockAuthAs(alice.id)

      const result = await deleteTemplate(tpl.id)

      expect(result).toEqual({ success: true })

      const deleted = await getTemplate(tpl.id)
      expect(deleted).toBeUndefined()

      const questions = await getTemplateQuestions(tpl.id)
      expect(questions).toHaveLength(0)
    })

    it('rejects system template deletion', async () => {
      const user = await createTestUser()
      const tpl = await createTestTemplate(null, {
        name: 'System',
        isSystem: true,
      })
      await mockAuthAs(user.id)

      const result = await deleteTemplate(tpl.id)

      expect(result).toEqual({
        success: false,
        error: 'System templates cannot be deleted.',
      })
    })

    it('rejects non-member of owning partnership', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const outsider = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const tpl = await createTestTemplate(partnership.id, {
        name: 'Private',
        createdById: alice.id,
      })
      await mockAuthAs(outsider.id)

      const result = await deleteTemplate(tpl.id)

      expect(result).toEqual({
        success: false,
        error: 'You are not a member of this partnership.',
      })
    })

    it('rejects unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await deleteTemplate('some-id')

      expect(result).toEqual({
        success: false,
        error: 'You must be logged in.',
      })
    })

    it('rejects non-existent template', async () => {
      const user = await createTestUser()
      await mockAuthAs(user.id)

      const result = await deleteTemplate('non-existent-id')

      expect(result).toEqual({
        success: false,
        error: 'Template not found.',
      })
    })

    it('allows partner to delete the other partners template', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const tpl = await createTestTemplate(partnership.id, {
        name: 'Alice Template',
        createdById: alice.id,
      })
      await mockAuthAs(bob.id)

      const result = await deleteTemplate(tpl.id)

      expect(result).toEqual({ success: true })
    })
  })

  // -----------------------------------------------------------------------
  // duplicateTemplate
  // -----------------------------------------------------------------------

  describe('duplicateTemplate', () => {
    it('duplicates system template with (Copy) suffix', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const systemTpl = await createTestTemplate(null, {
        name: 'Weekly Check-in',
        description: 'System desc',
        isSystem: true,
      })
      await createTestTemplateQuestion(systemTpl.id, {
        questionText: 'How are you?',
        orderIndex: 0,
      })
      await createTestTemplateQuestion(systemTpl.id, {
        questionText: 'What do you need?',
        orderIndex: 1,
      })
      await mockAuthAs(alice.id)

      const result = await duplicateTemplate(systemTpl.id)

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          templateId: expect.any(String),
        }),
      )

      if (result.success) {
        const copy = await getTemplate(result.templateId!)
        expect(copy).toEqual(
          expect.objectContaining({
            name: 'Weekly Check-in (Copy)',
            description: 'System desc',
            isSystem: false,
            partnershipId: partnership.id,
            createdById: alice.id,
          }),
        )

        const questions = await getTemplateQuestions(result.templateId!)
        expect(questions).toHaveLength(2)
        expect(questions[0]!.questionText).toBe('How are you?')
        expect(questions[0]!.orderIndex).toBe(0)
        expect(questions[1]!.questionText).toBe('What do you need?')
        expect(questions[1]!.orderIndex).toBe(1)
      }
    })

    it('duplicates custom template', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const tpl = await createTestTemplate(partnership.id, {
        name: 'Custom Template',
        createdById: alice.id,
      })
      await createTestTemplateQuestion(tpl.id, {
        questionText: 'Custom Q?',
        orderIndex: 0,
      })
      await mockAuthAs(bob.id)

      const result = await duplicateTemplate(tpl.id)

      expect(result.success).toBe(true)

      if (result.success) {
        const copy = await getTemplate(result.templateId!)
        expect(copy?.name).toBe('Custom Template (Copy)')
        expect(copy?.isSystem).toBe(false)
        expect(copy?.partnershipId).toBe(partnership.id)
        expect(copy?.createdById).toBe(bob.id)

        const questions = await getTemplateQuestions(result.templateId!)
        expect(questions).toHaveLength(1)
        expect(questions[0]!.questionText).toBe('Custom Q?')
      }
    })

    it('copies all questions with ordering preserved', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      await createTestPartnership(alice.id, bob.id, 'accepted')
      const tpl = await createTestTemplate(null, {
        name: 'Ordered',
        isSystem: true,
      })
      await createTestTemplateQuestion(tpl.id, {
        questionText: 'Third?',
        orderIndex: 2,
      })
      await createTestTemplateQuestion(tpl.id, {
        questionText: 'First?',
        orderIndex: 0,
      })
      await createTestTemplateQuestion(tpl.id, {
        questionText: 'Second?',
        orderIndex: 1,
      })
      await mockAuthAs(alice.id)

      const result = await duplicateTemplate(tpl.id)

      expect(result.success).toBe(true)
      if (result.success) {
        const questions = await getTemplateQuestions(result.templateId!)
        expect(questions.map(q => q.questionText)).toEqual([
          'First?',
          'Second?',
          'Third?',
        ])
        expect(questions.map(q => q.orderIndex)).toEqual([0, 1, 2])
      }
    })

    it('does not compound (Copy) suffix when duplicating a copy', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const tpl = await createTestTemplate(partnership.id, {
        name: 'Template (Copy)',
        createdById: alice.id,
      })
      await createTestTemplateQuestion(tpl.id, {
        questionText: 'Q?',
        orderIndex: 0,
      })
      await mockAuthAs(alice.id)

      const result = await duplicateTemplate(tpl.id)

      expect(result.success).toBe(true)
      if (result.success) {
        const copy = await getTemplate(result.templateId!)
        expect(copy?.name).toBe('Template (Copy)')
      }
    })

    it('rejects unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await duplicateTemplate('some-id')

      expect(result).toEqual({
        success: false,
        error: 'You must be logged in.',
      })
    })

    it('rejects user without active partnership', async () => {
      const user = await createTestUser()
      await mockAuthAs(user.id)

      const result = await duplicateTemplate('some-id')

      expect(result).toEqual({
        success: false,
        error: 'You must have an active partnership to duplicate templates.',
      })
    })

    it('rejects non-existent template', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      await createTestPartnership(alice.id, bob.id, 'accepted')
      await mockAuthAs(alice.id)

      const result = await duplicateTemplate('non-existent-id')

      expect(result).toEqual({
        success: false,
        error: 'Template not found.',
      })
    })

    it('rejects duplicating another partnerships custom template', async () => {
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

      const result = await duplicateTemplate(tpl.id)

      expect(result).toEqual({
        success: false,
        error: 'Template not found.',
      })
    })
  })
})
