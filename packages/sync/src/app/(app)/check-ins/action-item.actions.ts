'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { auth } from 'src/auth'
import { db } from 'src/db'
import { actionItems, checkInQuestions, partnerships } from 'src/db/schema'

import {
  getCheckInForUser,
  guardInProgress,
  validateActionItemDescription,
} from './helpers'
import type {
  ActionItemStatus,
  ActionResult,
  CreateActionItemInput,
} from './types'

// ---------------------------------------------------------------------------
// P4-A1: Create an action item for a check-in question
// ---------------------------------------------------------------------------

/**
 * Creates an action item linked to a specific check-in question.
 * Guard: check-in must be in_progress.
 * ownerType 'individual' requires ownerId (must be a partnership member).
 * ownerType 'both' requires ownerId to be omitted.
 */
export async function createActionItem(
  data: CreateActionItemInput,
): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  const userId = session.user.id

  // Validate description
  const descError = validateActionItemDescription(data.description)
  if (descError) {
    return { success: false, error: descError }
  }

  // Verify check-in access and status
  const checkIn = await getCheckInForUser(data.checkInId, userId)
  if (!checkIn) {
    return { success: false, error: 'Check-in not found.' }
  }

  const statusError = guardInProgress(checkIn.status)
  if (statusError) {
    return { success: false, error: statusError }
  }

  // Verify the question belongs to this check-in
  const [question] = await db
    .select({ id: checkInQuestions.id })
    .from(checkInQuestions)
    .where(
      and(
        eq(checkInQuestions.id, data.checkInQuestionId),
        eq(checkInQuestions.checkInId, data.checkInId),
      ),
    )
    .limit(1)

  if (!question) {
    return { success: false, error: 'Question not found.' }
  }

  // Validate owner constraints
  if (data.ownerType === 'individual') {
    if (!data.ownerId) {
      return {
        success: false,
        error: 'An owner must be specified for individual action items.',
      }
    }

    // Verify the ownerId is a member of the partnership
    const [partnership] = await db
      .select({
        inviterId: partnerships.inviterId,
        inviteeId: partnerships.inviteeId,
      })
      .from(partnerships)
      .where(eq(partnerships.id, checkIn.partnershipId))
      .limit(1)

    if (!partnership) {
      return { success: false, error: 'Partnership not found.' }
    }

    const isMember =
      data.ownerId === partnership.inviterId ||
      data.ownerId === partnership.inviteeId
    if (!isMember) {
      return { success: false, error: 'Owner must be a partnership member.' }
    }
  } else if (data.ownerType === 'both' && data.ownerId) {
    return {
      success: false,
      error: 'Shared action items should not have an individual owner.',
    }
  }

  try {
    await db.insert(actionItems).values({
      checkInId: data.checkInId,
      checkInQuestionId: data.checkInQuestionId,
      description: data.description.trim(),
      ownerType: data.ownerType,
      ownerId: data.ownerType === 'individual' ? data.ownerId! : null,
      createdById: userId,
    })

    revalidatePath(`/check-ins/${data.checkInId}`)

    return { success: true }
  } catch (error) {
    console.error('[createActionItem]', error)
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}

// ---------------------------------------------------------------------------
// P4-A2: Update action item status
// ---------------------------------------------------------------------------

/**
 * Updates the status of an action item.
 * Works regardless of check-in state (status changes can happen any time).
 * Sets/clears completedAt accordingly.
 */
export async function updateActionItemStatus(
  actionItemId: string,
  status: ActionItemStatus,
): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  const userId = session.user.id

  // Fetch the action item with its check-in
  const [item] = await db
    .select({
      id: actionItems.id,
      checkInId: actionItems.checkInId,
    })
    .from(actionItems)
    .where(eq(actionItems.id, actionItemId))
    .limit(1)

  if (!item) {
    return { success: false, error: 'Action item not found.' }
  }

  // Verify membership
  const checkIn = await getCheckInForUser(item.checkInId, userId)
  if (!checkIn) {
    return { success: false, error: 'Check-in not found.' }
  }

  try {
    await db
      .update(actionItems)
      .set({
        status,
        completedAt: status === 'completed' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(actionItems.id, actionItemId))

    revalidatePath(`/check-ins/${item.checkInId}`)

    return { success: true }
  } catch (error) {
    console.error('[updateActionItemStatus]', error)
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}

// ---------------------------------------------------------------------------
// P4-A4: Delete an action item
// ---------------------------------------------------------------------------

/**
 * Deletes an action item.
 * Guard: check-in must be in_progress.
 */
export async function deleteActionItem(
  actionItemId: string,
): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  const userId = session.user.id

  // Fetch the action item with its check-in
  const [item] = await db
    .select({
      id: actionItems.id,
      checkInId: actionItems.checkInId,
    })
    .from(actionItems)
    .where(eq(actionItems.id, actionItemId))
    .limit(1)

  if (!item) {
    return { success: false, error: 'Action item not found.' }
  }

  // Verify membership and status
  const checkIn = await getCheckInForUser(item.checkInId, userId)
  if (!checkIn) {
    return { success: false, error: 'Check-in not found.' }
  }

  const statusError = guardInProgress(checkIn.status)
  if (statusError) {
    return { success: false, error: statusError }
  }

  try {
    await db.delete(actionItems).where(eq(actionItems.id, actionItemId))

    revalidatePath(`/check-ins/${item.checkInId}`)

    return { success: true }
  } catch (error) {
    console.error('[deleteActionItem]', error)
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}
