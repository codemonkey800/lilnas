import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createTestPartnership,
  createTestProfile,
  createTestUser,
  getPartnership,
  mockAuthAs,
  truncateAll,
} from './helpers'

// Mock auth before importing actions (setup file mocks src/db and next/cache)
vi.mock('src/auth', () => ({
  auth: vi.fn(),
}))

// Import actions under test (these resolve to the mocked db/auth)
const {
  sendPartnerInvite,
  acceptInvite,
  declineInvite,
  cancelInvite,
  dissolvePartnership,
  getPartnershipStatus,
} = await import('src/app/(app)/partner/actions')

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('partner actions', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  // -----------------------------------------------------------------------
  // sendPartnerInvite
  // -----------------------------------------------------------------------

  describe('sendPartnerInvite', () => {
    it('creates a pending partnership for a valid invite', async () => {
      const inviter = await createTestUser({ email: 'alice@test.com' })
      await createTestUser({ email: 'bob@test.com' })
      await mockAuthAs(inviter.id)

      const result = await sendPartnerInvite('bob@test.com')

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          partnershipId: expect.any(String),
        }),
      )

      // Verify the partnership was created in the DB
      if (result.success) {
        const row = await getPartnership(result.partnershipId!)
        expect(row?.status).toBe('pending')
      }
    })

    it('rejects unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await sendPartnerInvite('bob@test.com')

      expect(result).toEqual({
        success: false,
        error: 'You must be logged in.',
      })
    })

    it('rejects invalid email (no @)', async () => {
      const inviter = await createTestUser()
      await mockAuthAs(inviter.id)

      const result = await sendPartnerInvite('not-an-email')

      expect(result).toEqual({
        success: false,
        error: 'Please enter a valid email address.',
      })
    })

    it('rejects empty email', async () => {
      const inviter = await createTestUser()
      await mockAuthAs(inviter.id)

      const result = await sendPartnerInvite('  ')

      expect(result).toEqual({
        success: false,
        error: 'Please enter a valid email address.',
      })
    })

    it('rejects self-invite', async () => {
      const user = await createTestUser({ email: 'alice@test.com' })
      await mockAuthAs(user.id)

      const result = await sendPartnerInvite('alice@test.com')

      expect(result).toEqual({
        success: false,
        error: 'You cannot invite yourself.',
      })
    })

    it('rejects when target user does not exist', async () => {
      const inviter = await createTestUser()
      await mockAuthAs(inviter.id)

      const result = await sendPartnerInvite('nobody@test.com')

      expect(result).toEqual({
        success: false,
        error: 'No account found with that email address.',
      })
    })

    it('rejects when inviter already has an active partner', async () => {
      const inviter = await createTestUser({ email: 'alice@test.com' })
      const existingPartner = await createTestUser({
        email: 'charlie@test.com',
      })
      await createTestUser({ email: 'bob@test.com' })
      await createTestPartnership(inviter.id, existingPartner.id, 'accepted')
      await mockAuthAs(inviter.id)

      const result = await sendPartnerInvite('bob@test.com')

      expect(result).toEqual({
        success: false,
        error: 'You already have an active partner.',
      })
    })

    it('rejects when inviter already has a pending outgoing invite', async () => {
      const inviter = await createTestUser({ email: 'alice@test.com' })
      const firstTarget = await createTestUser({ email: 'charlie@test.com' })
      await createTestUser({ email: 'bob@test.com' })
      await createTestPartnership(inviter.id, firstTarget.id, 'pending')
      await mockAuthAs(inviter.id)

      const result = await sendPartnerInvite('bob@test.com')

      expect(result).toEqual({
        success: false,
        error: 'You already have a pending invite. Cancel it first.',
      })
    })

    it('rejects when target user already has an active partner', async () => {
      const inviter = await createTestUser({ email: 'alice@test.com' })
      const target = await createTestUser({ email: 'bob@test.com' })
      const targetPartner = await createTestUser({ email: 'charlie@test.com' })
      await createTestPartnership(targetPartner.id, target.id, 'accepted')
      await mockAuthAs(inviter.id)

      const result = await sendPartnerInvite('bob@test.com')

      expect(result).toEqual({
        success: false,
        error: 'That person already has an active partner.',
      })
    })

    it('normalizes email to lowercase', async () => {
      const inviter = await createTestUser({ email: 'alice@test.com' })
      await createTestUser({ email: 'bob@test.com' })
      await mockAuthAs(inviter.id)

      const result = await sendPartnerInvite('  BOB@TEST.COM  ')

      expect(result.success).toBe(true)
    })

    it('allows re-invite after a previous invite was cancelled', async () => {
      const inviter = await createTestUser({ email: 'alice@test.com' })
      const target = await createTestUser({ email: 'bob@test.com' })
      await createTestPartnership(inviter.id, target.id, 'cancelled')
      await mockAuthAs(inviter.id)

      const result = await sendPartnerInvite('bob@test.com')

      expect(result.success).toBe(true)
    })

    it('allows re-invite after a previous invite was declined', async () => {
      const inviter = await createTestUser({ email: 'alice@test.com' })
      const target = await createTestUser({ email: 'bob@test.com' })
      await createTestPartnership(inviter.id, target.id, 'declined')
      await mockAuthAs(inviter.id)

      const result = await sendPartnerInvite('bob@test.com')

      expect(result.success).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // acceptInvite
  // -----------------------------------------------------------------------

  describe('acceptInvite', () => {
    it('accepts a valid pending invite', async () => {
      const inviter = await createTestUser()
      const invitee = await createTestUser()
      const partnership = await createTestPartnership(
        inviter.id,
        invitee.id,
        'pending',
      )
      await mockAuthAs(invitee.id)

      const result = await acceptInvite(partnership.id)

      expect(result).toEqual({ success: true })

      const row = await getPartnership(partnership.id)
      expect(row?.status).toBe('accepted')
    })

    it('rejects unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await acceptInvite('some-id')

      expect(result).toEqual({
        success: false,
        error: 'You must be logged in.',
      })
    })

    it('rejects if user is not the invitee', async () => {
      const inviter = await createTestUser()
      const invitee = await createTestUser()
      const outsider = await createTestUser()
      const partnership = await createTestPartnership(
        inviter.id,
        invitee.id,
        'pending',
      )
      await mockAuthAs(outsider.id)

      const result = await acceptInvite(partnership.id)

      expect(result).toEqual({
        success: false,
        error: 'This invite is not for you.',
      })
    })

    it('rejects if invite is not pending', async () => {
      const inviter = await createTestUser()
      const invitee = await createTestUser()
      const partnership = await createTestPartnership(
        inviter.id,
        invitee.id,
        'declined',
      )
      await mockAuthAs(invitee.id)

      const result = await acceptInvite(partnership.id)

      expect(result).toEqual({
        success: false,
        error: 'This invite is no longer pending.',
      })
    })

    it('rejects if invitee already has an active partner', async () => {
      const invitee = await createTestUser()
      const otherPartner = await createTestUser()
      // invitee already has an accepted partnership with someone else
      await createTestPartnership(otherPartner.id, invitee.id, 'accepted')
      await mockAuthAs(invitee.id)

      // Create a fresh pending invite from a different user
      const anotherInviter = await createTestUser()
      const pending = await createTestPartnership(
        anotherInviter.id,
        invitee.id,
        'pending',
      )

      const result = await acceptInvite(pending.id)

      expect(result).toEqual({
        success: false,
        error: 'You already have an active partner.',
      })
    })

    it('rejects non-existent invite', async () => {
      const user = await createTestUser()
      await mockAuthAs(user.id)

      const result = await acceptInvite('non-existent-id')

      expect(result).toEqual({ success: false, error: 'Invite not found.' })
    })

    it('does not auto-cancel other pending invites to the same invitee', async () => {
      const alice = await createTestUser()
      const bob = await createTestUser()
      const charlie = await createTestUser()
      const invite1 = await createTestPartnership(alice.id, bob.id, 'pending')
      const invite2 = await createTestPartnership(
        charlie.id,
        bob.id,
        'pending',
      )
      await mockAuthAs(bob.id)

      await acceptInvite(invite1.id)

      const staleInvite = await getPartnership(invite2.id)
      expect(staleInvite?.status).toBe('pending')
    })
  })

  // -----------------------------------------------------------------------
  // declineInvite
  // -----------------------------------------------------------------------

  describe('declineInvite', () => {
    it('declines a valid pending invite', async () => {
      const inviter = await createTestUser()
      const invitee = await createTestUser()
      const partnership = await createTestPartnership(
        inviter.id,
        invitee.id,
        'pending',
      )
      await mockAuthAs(invitee.id)

      const result = await declineInvite(partnership.id)

      expect(result).toEqual({ success: true })

      const row = await getPartnership(partnership.id)
      expect(row?.status).toBe('declined')
    })

    it('rejects unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await declineInvite('some-id')

      expect(result).toEqual({
        success: false,
        error: 'You must be logged in.',
      })
    })

    it('rejects if user is not the invitee', async () => {
      const inviter = await createTestUser()
      const invitee = await createTestUser()
      const outsider = await createTestUser()
      const partnership = await createTestPartnership(
        inviter.id,
        invitee.id,
        'pending',
      )
      await mockAuthAs(outsider.id)

      const result = await declineInvite(partnership.id)

      expect(result).toEqual({
        success: false,
        error: 'This invite is not for you.',
      })
    })

    it('rejects if invite is not pending', async () => {
      const inviter = await createTestUser()
      const invitee = await createTestUser()
      const partnership = await createTestPartnership(
        inviter.id,
        invitee.id,
        'accepted',
      )
      await mockAuthAs(invitee.id)

      const result = await declineInvite(partnership.id)

      expect(result).toEqual({
        success: false,
        error: 'This invite is no longer pending.',
      })
    })

    it('rejects non-existent invite', async () => {
      const user = await createTestUser()
      await mockAuthAs(user.id)

      const result = await declineInvite('non-existent-id')

      expect(result).toEqual({ success: false, error: 'Invite not found.' })
    })
  })

  // -----------------------------------------------------------------------
  // cancelInvite
  // -----------------------------------------------------------------------

  describe('cancelInvite', () => {
    it('cancels a valid pending invite', async () => {
      const inviter = await createTestUser()
      const invitee = await createTestUser()
      const partnership = await createTestPartnership(
        inviter.id,
        invitee.id,
        'pending',
      )
      await mockAuthAs(inviter.id)

      const result = await cancelInvite(partnership.id)

      expect(result).toEqual({ success: true })

      const row = await getPartnership(partnership.id)
      expect(row?.status).toBe('cancelled')
    })

    it('rejects unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await cancelInvite('some-id')

      expect(result).toEqual({
        success: false,
        error: 'You must be logged in.',
      })
    })

    it('rejects if user is not the inviter', async () => {
      const inviter = await createTestUser()
      const invitee = await createTestUser()
      const outsider = await createTestUser()
      const partnership = await createTestPartnership(
        inviter.id,
        invitee.id,
        'pending',
      )
      await mockAuthAs(outsider.id)

      const result = await cancelInvite(partnership.id)

      expect(result).toEqual({
        success: false,
        error: 'You did not send this invite.',
      })
    })

    it('rejects if invite is not pending', async () => {
      const inviter = await createTestUser()
      const invitee = await createTestUser()
      const partnership = await createTestPartnership(
        inviter.id,
        invitee.id,
        'accepted',
      )
      await mockAuthAs(inviter.id)

      const result = await cancelInvite(partnership.id)

      expect(result).toEqual({
        success: false,
        error: 'This invite is no longer pending.',
      })
    })

    it('rejects non-existent invite', async () => {
      const user = await createTestUser()
      await mockAuthAs(user.id)

      const result = await cancelInvite('non-existent-id')

      expect(result).toEqual({ success: false, error: 'Invite not found.' })
    })
  })

  // -----------------------------------------------------------------------
  // dissolvePartnership
  // -----------------------------------------------------------------------

  describe('dissolvePartnership', () => {
    it('dissolves an active partnership', async () => {
      const inviter = await createTestUser()
      const invitee = await createTestUser()
      const partnership = await createTestPartnership(
        inviter.id,
        invitee.id,
        'accepted',
      )
      await mockAuthAs(inviter.id)

      const result = await dissolvePartnership(partnership.id)

      expect(result).toEqual({ success: true })

      const row = await getPartnership(partnership.id)
      expect(row?.status).toBe('dissolved')
    })

    it('allows the invitee to dissolve', async () => {
      const inviter = await createTestUser()
      const invitee = await createTestUser()
      const partnership = await createTestPartnership(
        inviter.id,
        invitee.id,
        'accepted',
      )
      await mockAuthAs(invitee.id)

      const result = await dissolvePartnership(partnership.id)

      expect(result).toEqual({ success: true })

      const row = await getPartnership(partnership.id)
      expect(row?.status).toBe('dissolved')
    })

    it('rejects unauthenticated user', async () => {
      await mockAuthAs(null)

      const result = await dissolvePartnership('some-id')

      expect(result).toEqual({
        success: false,
        error: 'You must be logged in.',
      })
    })

    it('rejects if user is not a member', async () => {
      const inviter = await createTestUser()
      const invitee = await createTestUser()
      const outsider = await createTestUser()
      const partnership = await createTestPartnership(
        inviter.id,
        invitee.id,
        'accepted',
      )
      await mockAuthAs(outsider.id)

      const result = await dissolvePartnership(partnership.id)

      expect(result).toEqual({
        success: false,
        error: 'You are not a member of this partnership.',
      })
    })

    it('rejects if partnership is not in accepted status', async () => {
      const inviter = await createTestUser()
      const invitee = await createTestUser()
      const partnership = await createTestPartnership(
        inviter.id,
        invitee.id,
        'pending',
      )
      await mockAuthAs(inviter.id)

      const result = await dissolvePartnership(partnership.id)

      expect(result).toEqual({
        success: false,
        error: 'This partnership is not active.',
      })
    })

    it('rejects non-existent partnership', async () => {
      const user = await createTestUser()
      await mockAuthAs(user.id)

      const result = await dissolvePartnership('non-existent-id')

      expect(result).toEqual({
        success: false,
        error: 'Partnership not found.',
      })
    })
  })

  // -----------------------------------------------------------------------
  // getPartnershipStatus
  // -----------------------------------------------------------------------

  describe('getPartnershipStatus', () => {
    it('returns null when unauthenticated', async () => {
      await mockAuthAs(null)

      const result = await getPartnershipStatus()

      expect(result).toBeNull()
    })

    it('returns active partnership when one exists', async () => {
      const inviter = await createTestUser()
      const invitee = await createTestUser()
      const partnership = await createTestPartnership(
        inviter.id,
        invitee.id,
        'accepted',
      )
      await mockAuthAs(inviter.id)

      const result = await getPartnershipStatus()

      expect(result).toEqual({
        activePartnership: { id: partnership.id, partnerId: invitee.id },
        incomingInvites: [],
        outgoingInvite: null,
      })
    })

    it('returns active partnership with correct partnerId when user is invitee', async () => {
      const inviter = await createTestUser()
      const invitee = await createTestUser()
      const partnership = await createTestPartnership(
        inviter.id,
        invitee.id,
        'accepted',
      )
      await mockAuthAs(invitee.id)

      const result = await getPartnershipStatus()

      expect(result?.activePartnership).toEqual({
        id: partnership.id,
        partnerId: inviter.id,
      })
    })

    it('returns incoming invites with inviter info', async () => {
      const inviter = await createTestUser({ email: 'alice@test.com' })
      await createTestProfile(inviter.id, { displayName: 'Alice' })
      const invitee = await createTestUser()
      const partnership = await createTestPartnership(
        inviter.id,
        invitee.id,
        'pending',
      )
      await mockAuthAs(invitee.id)

      const result = await getPartnershipStatus()

      expect(result?.activePartnership).toBeNull()
      expect(result?.incomingInvites).toHaveLength(1)
      expect(result?.incomingInvites[0]).toEqual(
        expect.objectContaining({
          id: partnership.id,
          inviterDisplayName: 'Alice',
          inviterEmail: 'alice@test.com',
        }),
      )
    })

    it('returns outgoing invite with invitee info', async () => {
      const inviter = await createTestUser()
      const invitee = await createTestUser({ email: 'bob@test.com' })
      await createTestProfile(invitee.id, { displayName: 'Bob' })
      const partnership = await createTestPartnership(
        inviter.id,
        invitee.id,
        'pending',
      )
      await mockAuthAs(inviter.id)

      const result = await getPartnershipStatus()

      expect(result?.activePartnership).toBeNull()
      expect(result?.outgoingInvite).toEqual(
        expect.objectContaining({
          id: partnership.id,
          inviteeDisplayName: 'Bob',
          inviteeEmail: 'bob@test.com',
        }),
      )
    })

    it('returns empty state when no partnerships exist', async () => {
      const user = await createTestUser()
      await mockAuthAs(user.id)

      const result = await getPartnershipStatus()

      expect(result).toEqual({
        activePartnership: null,
        incomingInvites: [],
        outgoingInvite: null,
      })
    })

    it('returns multiple incoming invites', async () => {
      const invitee = await createTestUser()
      const alice = await createTestUser({ email: 'alice@test.com' })
      await createTestProfile(alice.id, { displayName: 'Alice' })
      const bob = await createTestUser({ email: 'bob@test.com' })
      await createTestProfile(bob.id, { displayName: 'Bob' })

      await createTestPartnership(alice.id, invitee.id, 'pending')
      await createTestPartnership(bob.id, invitee.id, 'pending')
      await mockAuthAs(invitee.id)

      const result = await getPartnershipStatus()

      expect(result?.incomingInvites).toHaveLength(2)
      const names = result?.incomingInvites.map(i => i.inviterDisplayName)
      expect(names).toContain('Alice')
      expect(names).toContain('Bob')
    })
  })
})
