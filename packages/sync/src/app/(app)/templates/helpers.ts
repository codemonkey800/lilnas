import { and, eq, or } from 'drizzle-orm'

import { db } from 'src/db'
import { partnerships } from 'src/db/schema'

import { MAX_QUESTIONS } from './constants'
import type { QuestionInput } from './types'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Look up the authenticated user's active (accepted) partnership.
 * Returns the partnership id or null if none found.
 */
export async function getActivePartnership(
  userId: string,
): Promise<{ id: string } | null> {
  const [active] = await db
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

  return active ?? null
}

/**
 * Validate a template name.
 * Returns an error string if invalid, null if valid.
 */
export function validateName(name: string): string | null {
  const trimmedName = name.trim()
  if (!trimmedName || trimmedName.length > 100) {
    return 'Template name must be between 1 and 100 characters.'
  }
  return null
}

/**
 * Validate a list of template questions.
 * Returns an error string if invalid, null if valid.
 */
export function validateQuestions(questions: QuestionInput[]): string | null {
  if (questions.length === 0) {
    return 'A template must have at least one question.'
  }
  if (questions.length > MAX_QUESTIONS) {
    return `A template can have at most ${MAX_QUESTIONS} questions.`
  }
  for (const q of questions) {
    const trimmedText = q.questionText.trim()
    if (!trimmedText || trimmedText.length > 500) {
      return 'Each question must be between 1 and 500 characters.'
    }
  }
  return null
}

/**
 * Validate the common name + questions constraints.
 * Returns an error string if invalid, null if valid.
 */
export function validateTemplateInput(
  name: string,
  questions: QuestionInput[],
): string | null {
  return validateName(name) ?? validateQuestions(questions)
}

/**
 * Check whether the given user is a member of an active (accepted)
 * partnership. Returns true if the user is a member and the partnership
 * is in accepted status.
 */
export async function isPartnershipMember(
  partnershipId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({
      inviterId: partnerships.inviterId,
      inviteeId: partnerships.inviteeId,
    })
    .from(partnerships)
    .where(
      and(
        eq(partnerships.id, partnershipId),
        eq(partnerships.status, 'accepted'),
      ),
    )
    .limit(1)

  if (!row) return false
  return row.inviterId === userId || row.inviteeId === userId
}
