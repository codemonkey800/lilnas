'use server'

import { and, count, desc, eq, inArray } from 'drizzle-orm'

import { auth } from 'src/auth'
import { db } from 'src/db'
import {
  checkInQuestions,
  checkInResponses,
  checkIns,
  partnerships,
  profiles,
} from 'src/db/schema'
import { getActivePartnership } from 'src/services/partnership'

import type { CheckInDetail, CheckInListItem } from './types'

// ---------------------------------------------------------------------------
// P3-A10: Get a single check-in with questions and responses
// ---------------------------------------------------------------------------

/**
 * Fetches a check-in with its questions and privacy-filtered responses.
 *
 * Privacy rules:
 *   - draft / scheduled: only the current user's responses are returned
 *   - in_progress / completed: both partners' responses are returned
 */
export async function getCheckIn(id: string): Promise<CheckInDetail | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const userId = session.user.id

  // Fetch the check-in and verify membership
  const [row] = await db
    .select({
      id: checkIns.id,
      title: checkIns.title,
      status: checkIns.status,
      templateId: checkIns.templateId,
      partnershipId: checkIns.partnershipId,
      scheduledFor: checkIns.scheduledFor,
      startedAt: checkIns.startedAt,
      completedAt: checkIns.completedAt,
      createdById: checkIns.createdById,
      createdAt: checkIns.createdAt,
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

  // If no questions, return early with empty responses
  if (questions.length === 0) {
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      templateId: row.templateId,
      partnershipId: row.partnershipId,
      scheduledFor: row.scheduledFor,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdById: row.createdById,
      createdAt: row.createdAt,
      questions: [],
      responses: [],
    }
  }

  // Fetch responses with display names (privacy-filtered)
  const isPrivate = row.status === 'draft' || row.status === 'scheduled'
  const questionIds = questions.map(q => q.id)

  const whereConditions = [
    inArray(checkInResponses.checkInQuestionId, questionIds),
  ]

  // In draft/scheduled state, only return the current user's responses
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
    scheduledFor: row.scheduledFor,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
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
      scheduledFor: checkIns.scheduledFor,
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
