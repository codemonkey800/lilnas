import { and, eq } from 'drizzle-orm'

import { db } from 'src/db'
import { checkIns, partnerships } from 'src/db/schema'

// ---------------------------------------------------------------------------
// Check-in-specific helpers
// ---------------------------------------------------------------------------

const MAX_TITLE_LENGTH = 200
const MAX_RESPONSE_LENGTH = 5_000
const MAX_ACTION_ITEM_DESCRIPTION_LENGTH = 500

/**
 * Fetch a check-in and verify the given user is a member of its partnership.
 * Returns the check-in row or null if not found / unauthorized.
 */
export async function getCheckInForUser(
  checkInId: string,
  userId: string,
): Promise<{
  id: string
  partnershipId: string
  status: 'draft' | 'in_progress' | 'completed'
  title: string
  pendingTransition: string | null
  pendingTransitionById: string | null
} | null> {
  const [row] = await db
    .select({
      id: checkIns.id,
      partnershipId: checkIns.partnershipId,
      status: checkIns.status,
      title: checkIns.title,
      pendingTransition: checkIns.pendingTransition,
      pendingTransitionById: checkIns.pendingTransitionById,
      inviterId: partnerships.inviterId,
      inviteeId: partnerships.inviteeId,
    })
    .from(checkIns)
    .innerJoin(
      partnerships,
      and(
        eq(partnerships.id, checkIns.partnershipId),
        eq(partnerships.status, 'accepted'),
      ),
    )
    .where(eq(checkIns.id, checkInId))
    .limit(1)

  if (!row) return null

  const isMember = row.inviterId === userId || row.inviteeId === userId
  if (!isMember) return null

  return {
    id: row.id,
    partnershipId: row.partnershipId,
    status: row.status,
    title: row.title,
    pendingTransition: row.pendingTransition,
    pendingTransitionById: row.pendingTransitionById,
  }
}

// ---------------------------------------------------------------------------
// State guards
// ---------------------------------------------------------------------------

type CheckInStatus = 'draft' | 'in_progress' | 'completed'

/**
 * Returns an error message if the check-in is NOT in draft state.
 */
export function guardDraft(status: CheckInStatus): string | null {
  if (status === 'draft') return null
  return 'This check-in can no longer be modified.'
}

/**
 * Returns an error message if the check-in is NOT in draft or in_progress
 * state (i.e. responses can still be saved).
 */
export function guardCanRespond(status: CheckInStatus): string | null {
  if (status === 'draft' || status === 'in_progress') return null
  return 'This check-in is completed. Re-open it to edit responses.'
}

/**
 * Returns an error message if the check-in is NOT in in_progress state.
 */
export function guardInProgress(status: CheckInStatus): string | null {
  if (status === 'in_progress') return null
  return 'This check-in is not currently in progress.'
}

/**
 * Returns an error message if the check-in is NOT in completed state.
 */
export function guardCompleted(status: CheckInStatus): string | null {
  if (status === 'completed') return null
  return 'This check-in is not completed.'
}

/**
 * Returns an error message if the check-in already has a pending transition.
 */
export function guardNoPendingTransition(
  pendingTransition: string | null,
): string | null {
  if (!pendingTransition) return null
  return 'A transition request is already pending for this check-in.'
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate a check-in title.
 * Returns an error string if invalid, null if valid.
 */
export function validateTitle(title: string): string | null {
  const trimmed = title.trim()
  if (!trimmed || trimmed.length > MAX_TITLE_LENGTH) {
    return `Title must be between 1 and ${MAX_TITLE_LENGTH} characters.`
  }
  return null
}

/**
 * Validate response text length.
 * Returns an error string if invalid, null if valid.
 */
export function validateResponseText(text: string): string | null {
  if (text.length > MAX_RESPONSE_LENGTH) {
    return `Response must be ${MAX_RESPONSE_LENGTH.toLocaleString()} characters or fewer.`
  }
  return null
}

/**
 * Validate an action item description.
 * Returns an error string if invalid, null if valid.
 */
export function validateActionItemDescription(
  description: string,
): string | null {
  const trimmed = description.trim()
  if (!trimmed || trimmed.length > MAX_ACTION_ITEM_DESCRIPTION_LENGTH) {
    return `Description must be between 1 and ${MAX_ACTION_ITEM_DESCRIPTION_LENGTH} characters.`
  }
  return null
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Format a display date string for a check-in list item.
 * Returns a prefixed string ("Completed: ...") or the plain creation date,
 * depending on the check-in status.
 */
export function formatCheckInDate(checkIn: {
  status: 'draft' | 'in_progress' | 'completed'
  completedAt: Date | null
  createdAt: Date | null
}): string | null {
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }

  if (checkIn.status === 'completed' && checkIn.completedAt) {
    return `Completed: ${checkIn.completedAt.toLocaleDateString('en-US', opts)}`
  }

  if (checkIn.createdAt) {
    return checkIn.createdAt.toLocaleDateString('en-US', opts)
  }

  return null
}
