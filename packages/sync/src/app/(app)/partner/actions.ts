'use server'

import { and, eq, or } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { auth } from 'src/auth'
import { db } from 'src/db'
import { partnerships, users } from 'src/db/schema'

import type { ActionResult } from './types'

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function sendPartnerInvite(email: string): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  const userId = session.user.id
  const normalizedEmail = email.trim().toLowerCase()

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return { success: false, error: 'Please enter a valid email address.' }
  }

  // Look up the target user by email (outside transaction -- read-only)
  const [targetUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1)

  if (!targetUser) {
    return {
      success: false,
      error: 'No account found with that email address.',
    }
  }

  // Cannot invite yourself
  if (targetUser.id === userId) {
    return { success: false, error: 'You cannot invite yourself.' }
  }

  try {
    return await db.transaction(async tx => {
      // Check if the current user already has an active partnership
      const [existingActive] = await tx
        .select({ id: partnerships.id })
        .from(partnerships)
        .where(
          and(
            eq(partnerships.status, 'accepted'),
            or(
              eq(partnerships.inviterId, userId),
              eq(partnerships.inviteeId, userId),
            ),
          ),
        )
        .limit(1)

      if (existingActive) {
        return { success: false, error: 'You already have an active partner.' }
      }

      // Check if the current user already has a pending outgoing invite
      const [existingOutgoing] = await tx
        .select({ id: partnerships.id })
        .from(partnerships)
        .where(
          and(
            eq(partnerships.inviterId, userId),
            eq(partnerships.status, 'pending'),
          ),
        )
        .limit(1)

      if (existingOutgoing) {
        return {
          success: false,
          error: 'You already have a pending invite. Cancel it first.',
        }
      }

      // Check if the target user already has an active partnership
      const [targetActive] = await tx
        .select({ id: partnerships.id })
        .from(partnerships)
        .where(
          and(
            eq(partnerships.status, 'accepted'),
            or(
              eq(partnerships.inviterId, targetUser.id),
              eq(partnerships.inviteeId, targetUser.id),
            ),
          ),
        )
        .limit(1)

      if (targetActive) {
        return {
          success: false,
          error: 'That person already has an active partner.',
        }
      }

      const rows = await tx
        .insert(partnerships)
        .values({
          inviterId: userId,
          inviteeId: targetUser.id,
          status: 'pending',
        })
        .returning({ id: partnerships.id })

      revalidatePath('/partner')

      return { success: true, partnershipId: rows[0]!.id } as const
    })
  } catch {
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}

export async function acceptInvite(
  partnershipId: string,
): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  const userId = session.user.id

  try {
    return await db.transaction(async tx => {
      // Verify the invite exists and belongs to this user as invitee
      const [invite] = await tx
        .select({
          id: partnerships.id,
          inviteeId: partnerships.inviteeId,
          status: partnerships.status,
        })
        .from(partnerships)
        .where(eq(partnerships.id, partnershipId))
        .limit(1)

      if (!invite) {
        return { success: false, error: 'Invite not found.' }
      }

      if (invite.inviteeId !== userId) {
        return { success: false, error: 'This invite is not for you.' }
      }

      if (invite.status !== 'pending') {
        return { success: false, error: 'This invite is no longer pending.' }
      }

      // Check the user doesn't already have an active partnership
      const [existingActive] = await tx
        .select({ id: partnerships.id })
        .from(partnerships)
        .where(
          and(
            eq(partnerships.status, 'accepted'),
            or(
              eq(partnerships.inviterId, userId),
              eq(partnerships.inviteeId, userId),
            ),
          ),
        )
        .limit(1)

      if (existingActive) {
        return { success: false, error: 'You already have an active partner.' }
      }

      await tx
        .update(partnerships)
        .set({ status: 'accepted', updatedAt: new Date() })
        .where(eq(partnerships.id, partnershipId))

      revalidatePath('/partner')
      revalidatePath('/')

      return { success: true } as const
    })
  } catch {
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}

export async function declineInvite(
  partnershipId: string,
): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  const userId = session.user.id

  const [invite] = await db
    .select({
      id: partnerships.id,
      inviteeId: partnerships.inviteeId,
      status: partnerships.status,
    })
    .from(partnerships)
    .where(eq(partnerships.id, partnershipId))
    .limit(1)

  if (!invite) {
    return { success: false, error: 'Invite not found.' }
  }

  if (invite.inviteeId !== userId) {
    return { success: false, error: 'This invite is not for you.' }
  }

  if (invite.status !== 'pending') {
    return { success: false, error: 'This invite is no longer pending.' }
  }

  try {
    await db
      .update(partnerships)
      .set({ status: 'declined', updatedAt: new Date() })
      .where(eq(partnerships.id, partnershipId))

    revalidatePath('/partner')

    return { success: true }
  } catch {
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}

export async function cancelInvite(
  partnershipId: string,
): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  const userId = session.user.id

  const [invite] = await db
    .select({
      id: partnerships.id,
      inviterId: partnerships.inviterId,
      status: partnerships.status,
    })
    .from(partnerships)
    .where(eq(partnerships.id, partnershipId))
    .limit(1)

  if (!invite) {
    return { success: false, error: 'Invite not found.' }
  }

  if (invite.inviterId !== userId) {
    return { success: false, error: 'You did not send this invite.' }
  }

  if (invite.status !== 'pending') {
    return { success: false, error: 'This invite is no longer pending.' }
  }

  try {
    await db
      .update(partnerships)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(partnerships.id, partnershipId))

    revalidatePath('/partner')

    return { success: true }
  } catch {
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}

export async function dissolvePartnership(
  partnershipId: string,
): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  const userId = session.user.id

  try {
    return await db.transaction(async tx => {
      const [partnership] = await tx
        .select({
          id: partnerships.id,
          inviterId: partnerships.inviterId,
          inviteeId: partnerships.inviteeId,
          status: partnerships.status,
        })
        .from(partnerships)
        .where(eq(partnerships.id, partnershipId))
        .limit(1)

      if (!partnership) {
        return { success: false, error: 'Partnership not found.' }
      }

      if (
        partnership.inviterId !== userId &&
        partnership.inviteeId !== userId
      ) {
        return {
          success: false,
          error: 'You are not a member of this partnership.',
        }
      }

      if (partnership.status !== 'accepted') {
        return { success: false, error: 'This partnership is not active.' }
      }

      await tx
        .update(partnerships)
        .set({ status: 'dissolved', updatedAt: new Date() })
        .where(eq(partnerships.id, partnershipId))

      revalidatePath('/')
      revalidatePath('/partner')

      return { success: true }
    })
  } catch {
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}
