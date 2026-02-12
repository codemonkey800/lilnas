import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createTestActionItem,
  createTestCheckIn,
  createTestCheckInQuestion,
  createTestPartnership,
  createTestUser,
  getActionItem,
  mockAuthAs,
  truncateAll,
} from './helpers'

// Mock auth before importing actions (setup file mocks src/db and next/cache)
vi.mock('src/auth', () => ({
  auth: vi.fn(),
}))

// Import actions under test (these resolve to the mocked db/auth)
const { createActionItem, updateActionItemStatus, deleteActionItem } =
  await import('src/app/(app)/check-ins/action-item.actions')

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('action item actions', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  // -----------------------------------------------------------------------
  // createActionItem
  // -----------------------------------------------------------------------

  describe('createActionItem', () => {
    it('requires authentication', async () => {
      await mockAuthAs(null)

      const result = await createActionItem({
        checkInId: 'some-id',
        checkInQuestionId: 'some-question-id',
        description: 'Do the thing',
        ownerType: 'individual',
        ownerId: 'some-owner-id',
      })

      expect(result).toEqual({
        success: false,
        error: 'You must be logged in.',
      })
    })

    it('requires in_progress check-in (completed should fail)', async () => {
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

      const result = await createActionItem({
        checkInId: ci.id,
        checkInQuestionId: question.id,
        description: 'Do something',
        ownerType: 'individual',
        ownerId: alice.id,
      })

      expect(result).toEqual({
        success: false,
        error: 'This check-in is not currently in progress.',
      })
    })

    it('validates empty description', async () => {
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

      const result = await createActionItem({
        checkInId: ci.id,
        checkInQuestionId: question.id,
        description: '',
        ownerType: 'individual',
        ownerId: alice.id,
      })

      expect(result).toEqual({
        success: false,
        error: 'Description must be between 1 and 500 characters.',
      })
    })

    it('validates description exceeding 500 characters', async () => {
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

      const result = await createActionItem({
        checkInId: ci.id,
        checkInQuestionId: question.id,
        description: 'x'.repeat(501),
        ownerType: 'individual',
        ownerId: alice.id,
      })

      expect(result).toEqual({
        success: false,
        error: 'Description must be between 1 and 500 characters.',
      })
    })

    it('rejects if question does not belong to the check-in', async () => {
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
      // Create a second check-in with its own question
      const otherCi = await createTestCheckIn(partnership.id, alice.id, {
        status: 'in_progress',
        startedAt: new Date(),
      })
      const otherQuestion = await createTestCheckInQuestion(otherCi.id)
      await mockAuthAs(alice.id)

      const result = await createActionItem({
        checkInId: ci.id,
        checkInQuestionId: otherQuestion.id,
        description: 'Do something',
        ownerType: 'individual',
        ownerId: alice.id,
      })

      expect(result).toEqual({
        success: false,
        error: 'Question not found.',
      })
    })

    it('individual owner: requires ownerId', async () => {
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

      const result = await createActionItem({
        checkInId: ci.id,
        checkInQuestionId: question.id,
        description: 'Do something',
        ownerType: 'individual',
      })

      expect(result).toEqual({
        success: false,
        error: 'An owner must be specified for individual action items.',
      })
    })

    it('individual owner: must be a partnership member', async () => {
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
      const question = await createTestCheckInQuestion(ci.id)
      await mockAuthAs(alice.id)

      const result = await createActionItem({
        checkInId: ci.id,
        checkInQuestionId: question.id,
        description: 'Do something',
        ownerType: 'individual',
        ownerId: outsider.id,
      })

      expect(result).toEqual({
        success: false,
        error: 'Owner must be a partnership member.',
      })
    })

    it('"both" owner: rejects if ownerId is provided', async () => {
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

      const result = await createActionItem({
        checkInId: ci.id,
        checkInQuestionId: question.id,
        description: 'Do something together',
        ownerType: 'both',
        ownerId: alice.id,
      })

      expect(result).toEqual({
        success: false,
        error: 'Shared action items should not have an individual owner.',
      })
    })

    it('succeeds with individual owner and inserts row correctly', async () => {
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

      const result = await createActionItem({
        checkInId: ci.id,
        checkInQuestionId: question.id,
        description: 'Buy flowers',
        ownerType: 'individual',
        ownerId: bob.id,
      })

      expect(result).toEqual({ success: true })

      // Verify the row was inserted by querying all action items for this check-in
      // We need to find the action item; since createActionItem doesn't return an id,
      // we use the test db helpers
      const { testDb } = await import('./helpers')
      const { actionItems: aiTable } = await import('src/db/schema')
      const { eq } = await import('drizzle-orm')

      const rows = await testDb
        .select()
        .from(aiTable)
        .where(eq(aiTable.checkInId, ci.id))

      expect(rows).toHaveLength(1)

      const item = rows[0]!
      expect(item.checkInId).toBe(ci.id)
      expect(item.checkInQuestionId).toBe(question.id)
      expect(item.description).toBe('Buy flowers')
      expect(item.ownerType).toBe('individual')
      expect(item.ownerId).toBe(bob.id)
      expect(item.createdById).toBe(alice.id)
      expect(item.status).toBe('open')
      expect(item.completedAt).toBeNull()
    })

    it('succeeds with "both" owner and sets ownerId to null', async () => {
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

      const result = await createActionItem({
        checkInId: ci.id,
        checkInQuestionId: question.id,
        description: 'Plan date night',
        ownerType: 'both',
      })

      expect(result).toEqual({ success: true })

      const { testDb } = await import('./helpers')
      const { actionItems: aiTable } = await import('src/db/schema')
      const { eq } = await import('drizzle-orm')

      const rows = await testDb
        .select()
        .from(aiTable)
        .where(eq(aiTable.checkInId, ci.id))

      expect(rows).toHaveLength(1)

      const item = rows[0]!
      expect(item.ownerType).toBe('both')
      expect(item.ownerId).toBeNull()
      expect(item.createdById).toBe(alice.id)
    })

    it('rejects whitespace-only description', async () => {
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

      const result = await createActionItem({
        checkInId: ci.id,
        checkInQuestionId: question.id,
        description: '   ',
        ownerType: 'individual',
        ownerId: alice.id,
      })

      expect(result).toEqual({
        success: false,
        error: 'Description must be between 1 and 500 characters.',
      })
    })

    it('trims description whitespace', async () => {
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

      const result = await createActionItem({
        checkInId: ci.id,
        checkInQuestionId: question.id,
        description: '  Do the dishes  ',
        ownerType: 'individual',
        ownerId: alice.id,
      })

      expect(result).toEqual({ success: true })

      const { testDb } = await import('./helpers')
      const { actionItems: aiTable } = await import('src/db/schema')
      const { eq } = await import('drizzle-orm')

      const rows = await testDb
        .select()
        .from(aiTable)
        .where(eq(aiTable.checkInId, ci.id))

      expect(rows).toHaveLength(1)
      expect(rows[0]!.description).toBe('Do the dishes')
    })
  })

  // -----------------------------------------------------------------------
  // updateActionItemStatus
  // -----------------------------------------------------------------------

  describe('updateActionItemStatus', () => {
    it('requires authentication', async () => {
      await mockAuthAs(null)

      const result = await updateActionItemStatus('some-id', 'completed')

      expect(result).toEqual({
        success: false,
        error: 'You must be logged in.',
      })
    })

    it('returns error for non-existent action item', async () => {
      const alice = await createTestUser()
      await mockAuthAs(alice.id)

      const result = await updateActionItemStatus(
        'non-existent-id',
        'completed',
      )

      expect(result).toEqual({
        success: false,
        error: 'Action item not found.',
      })
    })

    it('returns error when user is not a member of the partnership', async () => {
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
      const question = await createTestCheckInQuestion(ci.id)
      const actionItem = await createTestActionItem(
        ci.id,
        question.id,
        alice.id,
      )
      await mockAuthAs(outsider.id)

      const result = await updateActionItemStatus(actionItem.id, 'completed')

      expect(result).toEqual({
        success: false,
        error: 'Check-in not found.',
      })
    })

    it('sets status to completed and sets completedAt', async () => {
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
      const actionItem = await createTestActionItem(
        ci.id,
        question.id,
        alice.id,
        { status: 'open' },
      )
      await mockAuthAs(alice.id)

      const result = await updateActionItemStatus(actionItem.id, 'completed')

      expect(result).toEqual({ success: true })

      const updated = await getActionItem(actionItem.id)
      expect(updated).toBeDefined()
      expect(updated!.status).toBe('completed')
      expect(updated!.completedAt).toBeTruthy()
    })

    it('sets status to in_progress and clears completedAt', async () => {
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
      const actionItem = await createTestActionItem(
        ci.id,
        question.id,
        alice.id,
        { status: 'completed', completedAt: new Date() },
      )
      await mockAuthAs(alice.id)

      const result = await updateActionItemStatus(actionItem.id, 'in_progress')

      expect(result).toEqual({ success: true })

      const updated = await getActionItem(actionItem.id)
      expect(updated).toBeDefined()
      expect(updated!.status).toBe('in_progress')
      expect(updated!.completedAt).toBeNull()
    })

    it('works even on a completed check-in (no status guard)', async () => {
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
      const actionItem = await createTestActionItem(
        ci.id,
        question.id,
        alice.id,
        { status: 'open' },
      )
      await mockAuthAs(alice.id)

      const result = await updateActionItemStatus(actionItem.id, 'completed')

      expect(result).toEqual({ success: true })

      const updated = await getActionItem(actionItem.id)
      expect(updated!.status).toBe('completed')
      expect(updated!.completedAt).toBeTruthy()
    })
  })

  // -----------------------------------------------------------------------
  // deleteActionItem
  // -----------------------------------------------------------------------

  describe('deleteActionItem', () => {
    it('requires authentication', async () => {
      await mockAuthAs(null)

      const result = await deleteActionItem('some-id')

      expect(result).toEqual({
        success: false,
        error: 'You must be logged in.',
      })
    })

    it('returns error for non-existent action item', async () => {
      const alice = await createTestUser()
      await mockAuthAs(alice.id)

      const result = await deleteActionItem('non-existent-id')

      expect(result).toEqual({
        success: false,
        error: 'Action item not found.',
      })
    })

    it('requires in_progress check-in (completed should fail)', async () => {
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
      const actionItem = await createTestActionItem(
        ci.id,
        question.id,
        alice.id,
      )
      await mockAuthAs(alice.id)

      const result = await deleteActionItem(actionItem.id)

      expect(result).toEqual({
        success: false,
        error: 'This check-in is not currently in progress.',
      })
    })

    it('returns error when user is not a member', async () => {
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
      const question = await createTestCheckInQuestion(ci.id)
      const actionItem = await createTestActionItem(
        ci.id,
        question.id,
        alice.id,
      )
      await mockAuthAs(outsider.id)

      const result = await deleteActionItem(actionItem.id)

      expect(result).toEqual({
        success: false,
        error: 'Check-in not found.',
      })
    })

    it('removes the row on success', async () => {
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
      const actionItem = await createTestActionItem(
        ci.id,
        question.id,
        alice.id,
      )
      await mockAuthAs(alice.id)

      const result = await deleteActionItem(actionItem.id)

      expect(result).toEqual({ success: true })

      const deleted = await getActionItem(actionItem.id)
      expect(deleted).toBeUndefined()
    })
  })
})
