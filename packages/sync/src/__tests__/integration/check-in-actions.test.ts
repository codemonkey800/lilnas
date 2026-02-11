import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createTestCheckIn,
  createTestCheckInQuestion,
  createTestCheckInResponse,
  createTestPartnership,
  createTestTemplate,
  createTestTemplateQuestion,
  createTestUser,
  getCheckIn,
  getCheckInQuestions,
  getCheckInResponses,
  mockAuthAs,
  truncateAll,
} from './helpers'

// Mock auth before importing actions (setup file mocks src/db and next/cache)
vi.mock('src/auth', () => ({
  auth: vi.fn(),
}))

// Import actions under test (these resolve to the mocked db/auth)
const {
  createCheckIn,
  saveResponse,
  startCheckIn,
  completeCheckIn,
  reopenCheckIn,
} = await import('src/app/(app)/check-ins/actions')

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('check-in actions', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  // -----------------------------------------------------------------------
  // createCheckIn
  // -----------------------------------------------------------------------

  describe('createCheckIn', () => {
    it('creates a check-in from a template with questions copied', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const template = await createTestTemplate(partnership.id, {
        name: 'Weekly Sync',
        createdById: alice.id,
      })
      await createTestTemplateQuestion(template.id, {
        questionText: 'How are you feeling?',
        orderIndex: 0,
      })
      await createTestTemplateQuestion(template.id, {
        questionText: 'What do you need from me?',
        orderIndex: 1,
      })
      await mockAuthAs(alice.id)

      const result = await createCheckIn({ templateId: template.id })

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          checkInId: expect.any(String),
        }),
      )

      if (result.success) {
        const ci = await getCheckIn(result.checkInId!)
        expect(ci).toBeDefined()
        expect(ci!.status).toBe('draft')
        expect(ci!.partnershipId).toBe(partnership.id)
        expect(ci!.templateId).toBe(template.id)
        expect(ci!.createdById).toBe(alice.id)

        const questions = await getCheckInQuestions(result.checkInId!)
        expect(questions).toHaveLength(2)
        expect(questions[0]!.questionText).toBe('How are you feeling?')
        expect(questions[0]!.orderIndex).toBe(0)
        expect(questions[1]!.questionText).toBe('What do you need from me?')
        expect(questions[1]!.orderIndex).toBe(1)
      }
    })

    it('uses custom title when provided', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const template = await createTestTemplate(partnership.id, {
        name: 'Template',
        createdById: alice.id,
      })
      await createTestTemplateQuestion(template.id)
      await mockAuthAs(alice.id)

      const result = await createCheckIn({
        templateId: template.id,
        title: 'My Custom Title',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        const ci = await getCheckIn(result.checkInId!)
        expect(ci!.title).toBe('My Custom Title')
      }
    })

    it('generates default title from template name when no title provided', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const template = await createTestTemplate(partnership.id, {
        name: 'Weekly Sync',
        createdById: alice.id,
      })
      await createTestTemplateQuestion(template.id)
      await mockAuthAs(alice.id)

      const result = await createCheckIn({ templateId: template.id })

      expect(result.success).toBe(true)
      if (result.success) {
        const ci = await getCheckIn(result.checkInId!)
        expect(ci!.title).toMatch(/^Weekly Sync - /)
      }
    })

    it('sets status to scheduled when scheduledFor is a future date', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const template = await createTestTemplate(partnership.id, {
        name: 'Template',
        createdById: alice.id,
      })
      await createTestTemplateQuestion(template.id)
      await mockAuthAs(alice.id)

      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      const result = await createCheckIn({
        templateId: template.id,
        scheduledFor: futureDate,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        const ci = await getCheckIn(result.checkInId!)
        expect(ci!.status).toBe('scheduled')
        expect(ci!.scheduledFor).toBeTruthy()
      }
    })

    it('sets status to draft when no scheduledFor', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const template = await createTestTemplate(partnership.id, {
        name: 'Template',
        createdById: alice.id,
      })
      await createTestTemplateQuestion(template.id)
      await mockAuthAs(alice.id)

      const result = await createCheckIn({ templateId: template.id })

      expect(result.success).toBe(true)
      if (result.success) {
        const ci = await getCheckIn(result.checkInId!)
        expect(ci!.status).toBe('draft')
        expect(ci!.scheduledFor).toBeNull()
      }
    })

    it('rejects unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await createCheckIn({ templateId: 'some-id' })

      expect(result).toEqual({
        success: false,
        error: 'You must be logged in.',
      })
    })

    it('rejects user without active partnership', async () => {
      const user = await createTestUser()
      await mockAuthAs(user.id)

      const result = await createCheckIn({ templateId: 'some-id' })

      expect(result).toEqual({
        success: false,
        error: 'You must have an active partnership to create check-ins.',
      })
    })

    it('rejects non-existent template', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      await createTestPartnership(alice.id, bob.id, 'accepted')
      await mockAuthAs(alice.id)

      const result = await createCheckIn({ templateId: 'non-existent-id' })

      expect(result).toEqual({
        success: false,
        error: 'Template not found.',
      })
    })

    it('rejects template with zero questions', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const template = await createTestTemplate(partnership.id, {
        name: 'Empty Template',
        createdById: alice.id,
      })
      await mockAuthAs(alice.id)

      const result = await createCheckIn({ templateId: template.id })

      expect(result).toEqual({
        success: false,
        error: 'This template has no questions.',
      })
    })

    it('rejects title exceeding 200 characters', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const template = await createTestTemplate(partnership.id, {
        name: 'Template',
        createdById: alice.id,
      })
      await createTestTemplateQuestion(template.id)
      await mockAuthAs(alice.id)

      const result = await createCheckIn({
        templateId: template.id,
        title: 'x'.repeat(201),
      })

      expect(result).toEqual({
        success: false,
        error: 'Title must be between 1 and 200 characters.',
      })
    })
  })

  // -----------------------------------------------------------------------
  // saveResponse
  // -----------------------------------------------------------------------

  describe('saveResponse', () => {
    it('saves a new response to a question in draft check-in', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'draft',
      })
      const question = await createTestCheckInQuestion(ci.id)
      await mockAuthAs(alice.id)

      const result = await saveResponse(question.id, 'My answer')

      expect(result).toEqual({ success: true })

      const responses = await getCheckInResponses(question.id)
      expect(responses).toHaveLength(1)
      expect(responses[0]!.responseText).toBe('My answer')
      expect(responses[0]!.userId).toBe(alice.id)
      expect(responses[0]!.isDraft).toBe(true)
    })

    it('upserts an existing response', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'draft',
      })
      const question = await createTestCheckInQuestion(ci.id)
      await createTestCheckInResponse(question.id, alice.id, {
        responseText: 'Original answer',
        isDraft: true,
      })
      await mockAuthAs(alice.id)

      const result = await saveResponse(question.id, 'Updated answer')

      expect(result).toEqual({ success: true })

      const responses = await getCheckInResponses(question.id)
      expect(responses).toHaveLength(1)
      expect(responses[0]!.responseText).toBe('Updated answer')
    })

    it('sets isDraft=true for draft check-in', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'draft',
      })
      const question = await createTestCheckInQuestion(ci.id)
      await mockAuthAs(alice.id)

      await saveResponse(question.id, 'Draft answer')

      const responses = await getCheckInResponses(question.id)
      expect(responses[0]!.isDraft).toBe(true)
    })

    it('sets isDraft=true for scheduled check-in', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'scheduled',
      })
      const question = await createTestCheckInQuestion(ci.id)
      await mockAuthAs(alice.id)

      await saveResponse(question.id, 'Scheduled answer')

      const responses = await getCheckInResponses(question.id)
      expect(responses[0]!.isDraft).toBe(true)
    })

    it('sets isDraft=false for in_progress check-in', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'in_progress',
        startedAt: new Date(),
      })
      const question = await createTestCheckInQuestion(ci.id)
      await mockAuthAs(alice.id)

      await saveResponse(question.id, 'Active answer')

      const responses = await getCheckInResponses(question.id)
      expect(responses[0]!.isDraft).toBe(false)
    })

    it('rejects unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await saveResponse('some-question-id', 'answer')

      expect(result).toEqual({
        success: false,
        error: 'You must be logged in.',
      })
    })

    it('rejects non-existent question', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      await createTestPartnership(alice.id, bob.id, 'accepted')
      await mockAuthAs(alice.id)

      const result = await saveResponse('non-existent-id', 'answer')

      expect(result).toEqual({
        success: false,
        error: 'Question not found.',
      })
    })

    it('rejects non-member of the partnership', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const outsider = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'draft',
      })
      const question = await createTestCheckInQuestion(ci.id)
      await mockAuthAs(outsider.id)

      const result = await saveResponse(question.id, 'answer')

      expect(result).toEqual({
        success: false,
        error: 'Check-in not found.',
      })
    })

    it('rejects response on a completed check-in', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
      })
      const question = await createTestCheckInQuestion(ci.id)
      await mockAuthAs(alice.id)

      const result = await saveResponse(question.id, 'answer')

      expect(result).toEqual({
        success: false,
        error: 'This check-in is completed. Re-open it to edit responses.',
      })
    })

    it('rejects response text exceeding 5,000 characters', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'draft',
      })
      const question = await createTestCheckInQuestion(ci.id)
      await mockAuthAs(alice.id)

      const result = await saveResponse(question.id, 'x'.repeat(5_001))

      expect(result).toEqual({
        success: false,
        error: 'Response must be 5,000 characters or fewer.',
      })
    })
  })

  // -----------------------------------------------------------------------
  // startCheckIn
  // -----------------------------------------------------------------------

  describe('startCheckIn', () => {
    it('transitions draft to in_progress and sets startedAt', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'draft',
      })
      await createTestCheckInQuestion(ci.id)
      await mockAuthAs(alice.id)

      const result = await startCheckIn(ci.id)

      expect(result).toEqual(
        expect.objectContaining({ success: true, checkInId: ci.id }),
      )

      const updated = await getCheckIn(ci.id)
      expect(updated!.status).toBe('in_progress')
      expect(updated!.startedAt).toBeTruthy()
    })

    it('marks all draft responses as visible', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'draft',
      })
      const q1 = await createTestCheckInQuestion(ci.id, { orderIndex: 0 })
      const q2 = await createTestCheckInQuestion(ci.id, {
        questionText: 'Q2?',
        orderIndex: 1,
      })
      await createTestCheckInResponse(q1.id, alice.id, {
        responseText: 'Answer 1',
        isDraft: true,
      })
      await createTestCheckInResponse(q2.id, bob.id, {
        responseText: 'Answer 2',
        isDraft: true,
      })
      await mockAuthAs(alice.id)

      await startCheckIn(ci.id)

      const r1 = await getCheckInResponses(q1.id)
      const r2 = await getCheckInResponses(q2.id)
      expect(r1[0]!.isDraft).toBe(false)
      expect(r2[0]!.isDraft).toBe(false)
    })

    it('rejects unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await startCheckIn('some-id')

      expect(result).toEqual({
        success: false,
        error: 'You must be logged in.',
      })
    })

    it('rejects non-member', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const outsider = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'draft',
      })
      await mockAuthAs(outsider.id)

      const result = await startCheckIn(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'Check-in not found.',
      })
    })

    it('rejects if already in_progress', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'in_progress',
        startedAt: new Date(),
      })
      await mockAuthAs(alice.id)

      const result = await startCheckIn(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'This check-in can no longer be modified.',
      })
    })

    it('rejects if completed', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
      })
      await mockAuthAs(alice.id)

      const result = await startCheckIn(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'This check-in can no longer be modified.',
      })
    })
  })

  // -----------------------------------------------------------------------
  // completeCheckIn
  // -----------------------------------------------------------------------

  describe('completeCheckIn', () => {
    it('transitions in_progress to completed and sets completedAt', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'in_progress',
        startedAt: new Date(),
      })
      await mockAuthAs(alice.id)

      const result = await completeCheckIn(ci.id)

      expect(result).toEqual(
        expect.objectContaining({ success: true, checkInId: ci.id }),
      )

      const updated = await getCheckIn(ci.id)
      expect(updated!.status).toBe('completed')
      expect(updated!.completedAt).toBeTruthy()
    })

    it('rejects unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await completeCheckIn('some-id')

      expect(result).toEqual({
        success: false,
        error: 'You must be logged in.',
      })
    })

    it('rejects non-member', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const outsider = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'in_progress',
        startedAt: new Date(),
      })
      await mockAuthAs(outsider.id)

      const result = await completeCheckIn(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'Check-in not found.',
      })
    })

    it('rejects if still draft', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'draft',
      })
      await mockAuthAs(alice.id)

      const result = await completeCheckIn(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'This check-in is not currently in progress.',
      })
    })

    it('rejects if already completed', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
      })
      await mockAuthAs(alice.id)

      const result = await completeCheckIn(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'This check-in is not currently in progress.',
      })
    })
  })

  // -----------------------------------------------------------------------
  // reopenCheckIn
  // -----------------------------------------------------------------------

  describe('reopenCheckIn', () => {
    it('transitions completed back to in_progress and clears completedAt', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
      })
      await mockAuthAs(alice.id)

      const result = await reopenCheckIn(ci.id)

      expect(result).toEqual(
        expect.objectContaining({ success: true, checkInId: ci.id }),
      )

      const updated = await getCheckIn(ci.id)
      expect(updated!.status).toBe('in_progress')
      expect(updated!.completedAt).toBeNull()
    })

    it('rejects unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await reopenCheckIn('some-id')

      expect(result).toEqual({
        success: false,
        error: 'You must be logged in.',
      })
    })

    it('rejects non-member', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const outsider = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
      })
      await mockAuthAs(outsider.id)

      const result = await reopenCheckIn(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'Check-in not found.',
      })
    })

    it('rejects if not completed (draft)', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'draft',
      })
      await mockAuthAs(alice.id)

      const result = await reopenCheckIn(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'This check-in is not completed.',
      })
    })

    it('rejects if not completed (in_progress)', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'in_progress',
        startedAt: new Date(),
      })
      await mockAuthAs(alice.id)

      const result = await reopenCheckIn(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'This check-in is not completed.',
      })
    })
  })
})
