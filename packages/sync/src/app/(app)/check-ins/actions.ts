'use server'

import { and, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { auth } from 'src/auth'
import { db } from 'src/db'
import {
  checkInQuestions,
  checkInResponses,
  checkIns,
  checkInTemplates,
  templateQuestions,
} from 'src/db/schema'
import { getActivePartnership } from 'src/lib/partnership'

import {
  getCheckInForUser,
  guardCanRespond,
  guardCompleted,
  guardDraftOrScheduled,
  guardInProgress,
  validateResponseText,
  validateTitle,
} from './helpers'
import type { ActionResult, CreateCheckInInput } from './types'

// ---------------------------------------------------------------------------
// P3-A1: Create a check-in from a template
// ---------------------------------------------------------------------------

/**
 * Creates a new check-in by copying questions from the given template.
 * Title defaults to "{templateName} - {formatted date}" if not provided.
 * Status is `scheduled` when `scheduledFor` is a future date, else `draft`.
 */
export async function createCheckIn(
  data: CreateCheckInInput,
): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  const userId = session.user.id
  const activePartnership = await getActivePartnership(userId)

  if (!activePartnership) {
    return {
      success: false,
      error: 'You must have an active partnership to create check-ins.',
    }
  }

  // Fetch the template
  const [template] = await db
    .select({
      id: checkInTemplates.id,
      name: checkInTemplates.name,
    })
    .from(checkInTemplates)
    .where(eq(checkInTemplates.id, data.templateId))
    .limit(1)

  if (!template) {
    return { success: false, error: 'Template not found.' }
  }

  // Fetch template questions
  const questions = await db
    .select({
      questionText: templateQuestions.questionText,
      orderIndex: templateQuestions.orderIndex,
    })
    .from(templateQuestions)
    .where(eq(templateQuestions.templateId, template.id))
    .orderBy(templateQuestions.orderIndex)

  if (questions.length === 0) {
    return {
      success: false,
      error: 'This template has no questions.',
    }
  }

  // Determine title
  const title =
    data.title?.trim() ||
    `${template.name} - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  const titleError = validateTitle(title)
  if (titleError) {
    return { success: false, error: titleError }
  }

  // Determine initial status
  const now = new Date()
  const isScheduled = data.scheduledFor && data.scheduledFor > now
  const status = isScheduled ? 'scheduled' : 'draft'

  try {
    const checkInId = await db.transaction(async tx => {
      const rows = await tx
        .insert(checkIns)
        .values({
          partnershipId: activePartnership.id,
          templateId: template.id,
          title,
          status,
          scheduledFor: isScheduled ? data.scheduledFor : null,
          createdById: userId,
        })
        .returning({ id: checkIns.id })

      const newCheckInId = rows[0]!.id

      // Copy questions from template
      await tx.insert(checkInQuestions).values(
        questions.map(q => ({
          checkInId: newCheckInId,
          questionText: q.questionText,
          orderIndex: q.orderIndex,
        })),
      )

      return newCheckInId
    })

    revalidatePath('/check-ins')

    return { success: true, checkInId }
  } catch (error) {
    console.error('[createCheckIn]', error)
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}

// ---------------------------------------------------------------------------
// P3-A6: Save (upsert) a response to a check-in question
// ---------------------------------------------------------------------------

/**
 * Upserts a response for the current user on the given question.
 * Sets `isDraft` based on the check-in status:
 *   - draft/scheduled -> isDraft = true (private)
 *   - in_progress -> isDraft = false (visible to partner)
 */
export async function saveResponse(
  questionId: string,
  responseText: string,
): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  const userId = session.user.id

  // Validate response length
  const lengthError = validateResponseText(responseText)
  if (lengthError) {
    return { success: false, error: lengthError }
  }

  // Fetch the question and its check-in
  const [question] = await db
    .select({
      id: checkInQuestions.id,
      checkInId: checkInQuestions.checkInId,
    })
    .from(checkInQuestions)
    .where(eq(checkInQuestions.id, questionId))
    .limit(1)

  if (!question) {
    return { success: false, error: 'Question not found.' }
  }

  // Verify membership and get check-in status
  const checkIn = await getCheckInForUser(question.checkInId, userId)
  if (!checkIn) {
    return { success: false, error: 'Check-in not found.' }
  }

  const statusError = guardCanRespond(checkIn.status)
  if (statusError) {
    return { success: false, error: statusError }
  }

  const isDraft = checkIn.status === 'draft' || checkIn.status === 'scheduled'

  try {
    await db
      .insert(checkInResponses)
      .values({
        checkInQuestionId: questionId,
        userId,
        responseText,
        isDraft,
      })
      .onConflictDoUpdate({
        target: [checkInResponses.checkInQuestionId, checkInResponses.userId],
        set: {
          responseText,
          isDraft,
          updatedAt: new Date(),
        },
      })

    revalidatePath(`/check-ins/${question.checkInId}`)

    return { success: true }
  } catch (error) {
    console.error('[saveResponse]', error)
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}

// ---------------------------------------------------------------------------
// P3-A7: Start a check-in (transition to in_progress)
// ---------------------------------------------------------------------------

/**
 * Transitions a check-in from draft/scheduled to in_progress.
 * Sets startedAt and marks all existing draft responses as visible.
 */
export async function startCheckIn(checkInId: string): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  const checkIn = await getCheckInForUser(checkInId, session.user.id)
  if (!checkIn) {
    return { success: false, error: 'Check-in not found.' }
  }

  const statusError = guardDraftOrScheduled(checkIn.status)
  if (statusError) {
    return { success: false, error: statusError }
  }

  try {
    await db.transaction(async tx => {
      // Update check-in status
      await tx
        .update(checkIns)
        .set({
          status: 'in_progress',
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(checkIns.id, checkInId))

      // Get all question IDs for this check-in
      const questionIds = await tx
        .select({ id: checkInQuestions.id })
        .from(checkInQuestions)
        .where(eq(checkInQuestions.checkInId, checkInId))

      if (questionIds.length > 0) {
        // Mark all draft responses as visible
        await tx
          .update(checkInResponses)
          .set({ isDraft: false, updatedAt: new Date() })
          .where(
            and(
              inArray(
                checkInResponses.checkInQuestionId,
                questionIds.map(q => q.id),
              ),
              eq(checkInResponses.isDraft, true),
            ),
          )
      }
    })

    revalidatePath(`/check-ins/${checkInId}`)
    revalidatePath('/check-ins')

    return { success: true, checkInId }
  } catch (error) {
    console.error('[startCheckIn]', error)
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}

// ---------------------------------------------------------------------------
// P3-A8: Complete a check-in (transition to completed)
// ---------------------------------------------------------------------------

/**
 * Transitions a check-in from in_progress to completed.
 * Sets completedAt timestamp.
 */
export async function completeCheckIn(
  checkInId: string,
): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  const checkIn = await getCheckInForUser(checkInId, session.user.id)
  if (!checkIn) {
    return { success: false, error: 'Check-in not found.' }
  }

  const statusError = guardInProgress(checkIn.status)
  if (statusError) {
    return { success: false, error: statusError }
  }

  try {
    await db
      .update(checkIns)
      .set({
        status: 'completed',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(checkIns.id, checkInId))

    revalidatePath(`/check-ins/${checkInId}`)
    revalidatePath('/check-ins')

    return { success: true, checkInId }
  } catch (error) {
    console.error('[completeCheckIn]', error)
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}

// ---------------------------------------------------------------------------
// P3-A9: Re-open a check-in (transition back to in_progress)
// ---------------------------------------------------------------------------

/**
 * Transitions a completed check-in back to in_progress.
 * Clears completedAt so answers become editable again.
 */
export async function reopenCheckIn(checkInId: string): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  const checkIn = await getCheckInForUser(checkInId, session.user.id)
  if (!checkIn) {
    return { success: false, error: 'Check-in not found.' }
  }

  const statusError = guardCompleted(checkIn.status)
  if (statusError) {
    return { success: false, error: statusError }
  }

  try {
    await db
      .update(checkIns)
      .set({
        status: 'in_progress',
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(checkIns.id, checkInId))

    revalidatePath(`/check-ins/${checkInId}`)
    revalidatePath('/check-ins')

    return { success: true, checkInId }
  } catch (error) {
    console.error('[reopenCheckIn]', error)
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}
