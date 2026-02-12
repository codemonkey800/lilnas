'use server'

import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import { auth } from 'src/auth'
import { db } from 'src/db'
import {
  actionItems,
  checkInQuestions,
  checkInResponses,
  checkIns,
  partnerships,
  profiles,
} from 'src/db/schema'
import { getActivePartnership } from 'src/services/partnership'

import type {
  ActionItem,
  CheckInDetail,
  CheckInListItem,
  DashboardActionItem,
  PendingTransition,
} from './types'

// ---------------------------------------------------------------------------
// P3-A10: Get a single check-in with questions and responses
// ---------------------------------------------------------------------------

/**
 * Fetches a check-in with its questions and privacy-filtered responses.
 *
 * Privacy rules:
 *   - draft: only the current user's responses are returned
 *   - in_progress / completed: both partners' responses are returned
 */
export async function getCheckIn(id: string): Promise<CheckInDetail | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const userId = session.user.id

  // Alias for the profile of the user who initiated a pending transition
  const pendingByProfile = alias(profiles, 'pending_by_profile')

  // Alias for the partner's profile (inviter or invitee who is NOT the current user)
  const inviterProfile = alias(profiles, 'inviter_profile')
  const inviteeProfile = alias(profiles, 'invitee_profile')

  // Fetch the check-in and verify membership
  const [row] = await db
    .select({
      id: checkIns.id,
      title: checkIns.title,
      status: checkIns.status,
      templateId: checkIns.templateId,
      partnershipId: checkIns.partnershipId,
      startedAt: checkIns.startedAt,
      completedAt: checkIns.completedAt,
      pendingTransition: checkIns.pendingTransition,
      pendingTransitionById: checkIns.pendingTransitionById,
      pendingTransitionByName: pendingByProfile.displayName,
      createdById: checkIns.createdById,
      createdAt: checkIns.createdAt,
      inviterId: partnerships.inviterId,
      inviteeId: partnerships.inviteeId,
      inviterDisplayName: inviterProfile.displayName,
      inviteeDisplayName: inviteeProfile.displayName,
    })
    .from(checkIns)
    .innerJoin(
      partnerships,
      and(
        eq(partnerships.id, checkIns.partnershipId),
        eq(partnerships.status, 'accepted'),
      ),
    )
    .leftJoin(
      pendingByProfile,
      eq(pendingByProfile.userId, checkIns.pendingTransitionById),
    )
    .leftJoin(inviterProfile, eq(inviterProfile.userId, partnerships.inviterId))
    .leftJoin(inviteeProfile, eq(inviteeProfile.userId, partnerships.inviteeId))
    .where(eq(checkIns.id, id))
    .limit(1)

  if (!row) return null

  // Verify membership
  const isMember = row.inviterId === userId || row.inviteeId === userId
  if (!isMember) return null

  // Fetch questions ordered by orderIndex
  const questions = await db
    .select({
      id: checkInQuestions.id,
      questionText: checkInQuestions.questionText,
      orderIndex: checkInQuestions.orderIndex,
    })
    .from(checkInQuestions)
    .where(eq(checkInQuestions.checkInId, id))
    .orderBy(checkInQuestions.orderIndex)

  // Resolve the partner's display name (the other user in the partnership)
  const partnerDisplayName =
    row.inviterId === userId ? row.inviteeDisplayName : row.inviterDisplayName

  // If no questions, return early with empty responses
  if (questions.length === 0) {
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      templateId: row.templateId,
      partnershipId: row.partnershipId,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      pendingTransition: (row.pendingTransition as PendingTransition) ?? null,
      pendingTransitionById: row.pendingTransitionById,
      pendingTransitionByName: row.pendingTransitionByName,
      partnerDisplayName: partnerDisplayName ?? null,
      createdById: row.createdById,
      createdAt: row.createdAt,
      questions: [],
      responses: [],
    }
  }

  // Fetch responses with display names (privacy-filtered)
  const isPrivate = row.status === 'draft'
  const questionIds = questions.map(q => q.id)

  const whereConditions = [
    inArray(checkInResponses.checkInQuestionId, questionIds),
  ]

  // In draft state, only return the current user's responses
  if (isPrivate) {
    whereConditions.push(eq(checkInResponses.userId, userId))
  }

  const responses = await db
    .select({
      id: checkInResponses.id,
      checkInQuestionId: checkInResponses.checkInQuestionId,
      userId: checkInResponses.userId,
      displayName: profiles.displayName,
      responseText: checkInResponses.responseText,
    })
    .from(checkInResponses)
    .innerJoin(profiles, eq(profiles.userId, checkInResponses.userId))
    .where(and(...whereConditions))

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    templateId: row.templateId,
    partnershipId: row.partnershipId,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    pendingTransition: (row.pendingTransition as PendingTransition) ?? null,
    pendingTransitionById: row.pendingTransitionById,
    pendingTransitionByName: row.pendingTransitionByName,
    partnerDisplayName: partnerDisplayName ?? null,
    createdById: row.createdById,
    createdAt: row.createdAt,
    questions,
    responses,
  }
}

// ---------------------------------------------------------------------------
// P3-A11: List check-ins for the current user's partnership
// ---------------------------------------------------------------------------

/**
 * Returns all check-ins for the current user's active partnership,
 * ordered by most recent first.
 */
export async function getCheckIns(): Promise<CheckInListItem[] | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const userId = session.user.id
  const activePartnership = await getActivePartnership(userId)

  if (!activePartnership) return null

  const rows = await db
    .select({
      id: checkIns.id,
      title: checkIns.title,
      status: checkIns.status,
      completedAt: checkIns.completedAt,
      createdAt: checkIns.createdAt,
      questionCount: count(checkInQuestions.id),
    })
    .from(checkIns)
    .leftJoin(checkInQuestions, eq(checkInQuestions.checkInId, checkIns.id))
    .where(eq(checkIns.partnershipId, activePartnership.id))
    .groupBy(checkIns.id)
    .orderBy(desc(checkIns.createdAt))

  return rows
}

// ---------------------------------------------------------------------------
// P4-A5: Get action items for a check-in
// ---------------------------------------------------------------------------

/**
 * Fetches all action items for a check-in with owner display names resolved.
 * Returns items ordered by creation date (oldest first).
 */
export async function getActionItemsForCheckIn(
  checkInId: string,
): Promise<ActionItem[]> {
  const session = await auth()
  if (!session?.user?.id) return []

  const rows = await db
    .select({
      id: actionItems.id,
      checkInId: actionItems.checkInId,
      checkInQuestionId: actionItems.checkInQuestionId,
      description: actionItems.description,
      ownerType: actionItems.ownerType,
      ownerId: actionItems.ownerId,
      ownerDisplayName: profiles.displayName,
      createdById: actionItems.createdById,
      status: actionItems.status,
      dueDate: actionItems.dueDate,
      completedAt: actionItems.completedAt,
      createdAt: actionItems.createdAt,
    })
    .from(actionItems)
    .leftJoin(profiles, eq(profiles.userId, actionItems.ownerId))
    .where(eq(actionItems.checkInId, checkInId))
    .orderBy(asc(actionItems.createdAt))

  // "both"-type items have no individual owner, so ownerDisplayName should be null
  return rows.map(row => ({
    ...row,
    ownerDisplayName: row.ownerType === 'both' ? null : row.ownerDisplayName,
  }))
}

// ---------------------------------------------------------------------------
// P4-A5: Get all action items for the current user's active partnership
// ---------------------------------------------------------------------------

/**
 * Fetches all action items for the current user's active partnership.
 * Includes all owner types (individual + both) and all statuses
 * (open, in_progress, completed) to support client-side filtering.
 *
 * Sorted by due date (soonest first, nulls last), then by creation date.
 */
export async function getMyActionItems(): Promise<DashboardActionItem[]> {
  const session = await auth()
  if (!session?.user?.id) return []

  const userId = session.user.id
  const activePartnership = await getActivePartnership(userId)

  if (!activePartnership) return []

  const rows = await db
    .select({
      id: actionItems.id,
      checkInId: actionItems.checkInId,
      checkInQuestionId: actionItems.checkInQuestionId,
      description: actionItems.description,
      ownerType: actionItems.ownerType,
      ownerId: actionItems.ownerId,
      ownerDisplayName: profiles.displayName,
      createdById: actionItems.createdById,
      status: actionItems.status,
      dueDate: actionItems.dueDate,
      completedAt: actionItems.completedAt,
      createdAt: actionItems.createdAt,
      checkInTitle: checkIns.title,
    })
    .from(actionItems)
    .innerJoin(checkIns, eq(checkIns.id, actionItems.checkInId))
    .leftJoin(profiles, eq(profiles.userId, actionItems.ownerId))
    .where(eq(checkIns.partnershipId, activePartnership.id))
    .orderBy(
      sql`${actionItems.dueDate} ASC NULLS LAST`,
      asc(actionItems.createdAt),
    )

  return rows.map(row => ({
    ...row,
    ownerDisplayName: row.ownerType === 'both' ? null : row.ownerDisplayName,
  }))
}
