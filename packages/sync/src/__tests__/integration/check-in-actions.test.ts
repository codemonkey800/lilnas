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
  confirmTransition,
  cancelTransition,
} = await import('src/app/(app)/check-ins/check-in.actions')

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

    it('sets status to draft', async () => {
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

    it('rejects whitespace-only title', async () => {
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
        title: '   ',
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

    it('both partners can save responses to the same question independently', async () => {
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

      // Alice saves
      await mockAuthAs(alice.id)
      const r1 = await saveResponse(question.id, "Alice's answer")
      expect(r1).toEqual({ success: true })

      // Bob saves
      await mockAuthAs(bob.id)
      const r2 = await saveResponse(question.id, "Bob's answer")
      expect(r2).toEqual({ success: true })

      // Both responses exist independently
      const responses = await getCheckInResponses(question.id)
      expect(responses).toHaveLength(2)

      const aliceResp = responses.find(r => r.userId === alice.id)
      const bobResp = responses.find(r => r.userId === bob.id)
      expect(aliceResp!.responseText).toBe("Alice's answer")
      expect(bobResp!.responseText).toBe("Bob's answer")
    })
  })

  // -----------------------------------------------------------------------
  // startCheckIn (creates pending request, does NOT transition immediately)
  // -----------------------------------------------------------------------

  describe('startCheckIn', () => {
    it('creates a pending start request without changing status', async () => {
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
      expect(updated!.status).toBe('draft')
      expect(updated!.startedAt).toBeNull()
      expect(updated!.pendingTransition).toBe('start')
      expect(updated!.pendingTransitionById).toBe(alice.id)
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

    it('rejects if there is already a pending transition', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'draft',
        pendingTransition: 'start',
        pendingTransitionById: alice.id,
      })
      await mockAuthAs(bob.id)

      const result = await startCheckIn(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'A transition request is already pending for this check-in.',
      })
    })
  })

  // -----------------------------------------------------------------------
  // completeCheckIn (creates pending request, does NOT transition immediately)
  // -----------------------------------------------------------------------

  describe('completeCheckIn', () => {
    it('creates a pending complete request without changing status', async () => {
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
      expect(updated!.status).toBe('in_progress')
      expect(updated!.completedAt).toBeNull()
      expect(updated!.pendingTransition).toBe('complete')
      expect(updated!.pendingTransitionById).toBe(alice.id)
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

    it('rejects if there is already a pending transition', async () => {
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
        pendingTransition: 'complete',
        pendingTransitionById: alice.id,
      })
      await mockAuthAs(bob.id)

      const result = await completeCheckIn(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'A transition request is already pending for this check-in.',
      })
    })
  })

  // -----------------------------------------------------------------------
  // reopenCheckIn (creates pending request, does NOT transition immediately)
  // -----------------------------------------------------------------------

  describe('reopenCheckIn', () => {
    it('creates a pending reopen request without changing status', async () => {
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
      expect(updated!.status).toBe('completed')
      expect(updated!.completedAt).toBeTruthy()
      expect(updated!.pendingTransition).toBe('reopen')
      expect(updated!.pendingTransitionById).toBe(alice.id)
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

    it('rejects if there is already a pending transition', async () => {
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
        pendingTransition: 'reopen',
        pendingTransitionById: alice.id,
      })
      await mockAuthAs(bob.id)

      const result = await reopenCheckIn(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'A transition request is already pending for this check-in.',
      })
    })
  })

  // -----------------------------------------------------------------------
  // confirmTransition
  // -----------------------------------------------------------------------

  describe('confirmTransition', () => {
    it('confirms start: transitions draft to in_progress, sets startedAt, marks drafts visible', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'draft',
        pendingTransition: 'start',
        pendingTransitionById: alice.id,
      })
      const q = await createTestCheckInQuestion(ci.id)
      await createTestCheckInResponse(q.id, alice.id, {
        responseText: 'Draft answer',
        isDraft: true,
      })
      await mockAuthAs(bob.id) // Bob (partner) confirms

      const result = await confirmTransition(ci.id)

      expect(result).toEqual(
        expect.objectContaining({ success: true, checkInId: ci.id }),
      )

      const updated = await getCheckIn(ci.id)
      expect(updated!.status).toBe('in_progress')
      expect(updated!.startedAt).toBeTruthy()
      expect(updated!.pendingTransition).toBeNull()
      expect(updated!.pendingTransitionById).toBeNull()

      const responses = await getCheckInResponses(q.id)
      expect(responses[0]!.isDraft).toBe(false)
    })

    it('confirms complete: transitions in_progress to completed, sets completedAt', async () => {
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
        pendingTransition: 'complete',
        pendingTransitionById: alice.id,
      })
      await mockAuthAs(bob.id) // Bob confirms

      const result = await confirmTransition(ci.id)

      expect(result).toEqual(
        expect.objectContaining({ success: true, checkInId: ci.id }),
      )

      const updated = await getCheckIn(ci.id)
      expect(updated!.status).toBe('completed')
      expect(updated!.completedAt).toBeTruthy()
      expect(updated!.pendingTransition).toBeNull()
      expect(updated!.pendingTransitionById).toBeNull()
    })

    it('confirms reopen: transitions completed to in_progress, clears completedAt', async () => {
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
        pendingTransition: 'reopen',
        pendingTransitionById: alice.id,
      })
      await mockAuthAs(bob.id) // Bob confirms

      const result = await confirmTransition(ci.id)

      expect(result).toEqual(
        expect.objectContaining({ success: true, checkInId: ci.id }),
      )

      const updated = await getCheckIn(ci.id)
      expect(updated!.status).toBe('in_progress')
      expect(updated!.completedAt).toBeNull()
      expect(updated!.pendingTransition).toBeNull()
      expect(updated!.pendingTransitionById).toBeNull()
    })

    it('rejects unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await confirmTransition('some-id')

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
        pendingTransition: 'start',
        pendingTransitionById: alice.id,
      })
      await mockAuthAs(outsider.id)

      const result = await confirmTransition(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'Check-in not found.',
      })
    })

    it('rejects if no pending transition', async () => {
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
      await mockAuthAs(bob.id)

      const result = await confirmTransition(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'No pending transition to confirm.',
      })
    })

    it('rejects if initiator tries to confirm own request', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'draft',
        pendingTransition: 'start',
        pendingTransitionById: alice.id,
      })
      await mockAuthAs(alice.id) // Alice initiated -- she cannot confirm

      const result = await confirmTransition(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'You cannot confirm your own transition request.',
      })
    })
  })

  // -----------------------------------------------------------------------
  // cancelTransition
  // -----------------------------------------------------------------------

  describe('cancelTransition', () => {
    it('cancels a pending transition without changing status', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'draft',
        pendingTransition: 'start',
        pendingTransitionById: alice.id,
      })
      await mockAuthAs(alice.id) // Alice initiated -- she can cancel

      const result = await cancelTransition(ci.id)

      expect(result).toEqual(
        expect.objectContaining({ success: true, checkInId: ci.id }),
      )

      const updated = await getCheckIn(ci.id)
      expect(updated!.status).toBe('draft')
      expect(updated!.pendingTransition).toBeNull()
      expect(updated!.pendingTransitionById).toBeNull()
    })

    it('rejects unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await cancelTransition('some-id')

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
        pendingTransition: 'start',
        pendingTransitionById: alice.id,
      })
      await mockAuthAs(outsider.id)

      const result = await cancelTransition(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'Check-in not found.',
      })
    })

    it('rejects if no pending transition', async () => {
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

      const result = await cancelTransition(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'No pending transition to cancel.',
      })
    })

    it('rejects if non-initiator tries to cancel', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const partnership = await createTestPartnership(
        alice.id,
        bob.id,
        'accepted',
      )
      const ci = await createTestCheckIn(partnership.id, alice.id, {
        status: 'draft',
        pendingTransition: 'start',
        pendingTransitionById: alice.id,
      })
      await mockAuthAs(bob.id) // Bob did not initiate -- he cannot cancel

      const result = await cancelTransition(ci.id)

      expect(result).toEqual({
        success: false,
        error: 'Only the person who initiated the request can cancel it.',
      })
    })
  })
})
