'use server'

import { count, eq, or } from 'drizzle-orm'

import { auth } from 'src/auth'
import { db } from 'src/db'
import { checkInTemplates, templateQuestions } from 'src/db/schema'

import { getActivePartnership, isPartnershipMember } from './helpers'
import type { TemplateDetail, TemplateListItem } from './types'

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * P2-A5: List all available templates for the current user.
 * Returns system templates + custom templates belonging to the user's partnership.
 */
export async function getTemplates(): Promise<TemplateListItem[] | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const userId = session.user.id
  const activePartnership = await getActivePartnership(userId)

  // Build a list of templates: system + user's partnership custom templates
  const rows = await db
    .select({
      id: checkInTemplates.id,
      name: checkInTemplates.name,
      description: checkInTemplates.description,
      isSystem: checkInTemplates.isSystem,
      questionCount: count(templateQuestions.id),
    })
    .from(checkInTemplates)
    .leftJoin(
      templateQuestions,
      eq(templateQuestions.templateId, checkInTemplates.id),
    )
    .where(
      activePartnership
        ? or(
            eq(checkInTemplates.isSystem, true),
            eq(checkInTemplates.partnershipId, activePartnership.id),
          )
        : eq(checkInTemplates.isSystem, true),
    )
    .groupBy(checkInTemplates.id)
    .orderBy(checkInTemplates.isSystem, checkInTemplates.name)

  return rows
}

/**
 * P2-A6: Get a single template with its questions.
 */
export async function getTemplate(
  id: string,
): Promise<TemplateDetail | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const userId = session.user.id

  // Fetch the template
  const [template] = await db
    .select({
      id: checkInTemplates.id,
      name: checkInTemplates.name,
      description: checkInTemplates.description,
      isSystem: checkInTemplates.isSystem,
      partnershipId: checkInTemplates.partnershipId,
      createdById: checkInTemplates.createdById,
    })
    .from(checkInTemplates)
    .where(eq(checkInTemplates.id, id))
    .limit(1)

  if (!template) return null

  // Authorization: system templates readable by all; custom only by members
  if (!template.isSystem && template.partnershipId) {
    const isMember = await isPartnershipMember(template.partnershipId, userId)
    if (!isMember) return null
  }

  // Fetch ordered questions
  const questions = await db
    .select({
      id: templateQuestions.id,
      questionText: templateQuestions.questionText,
      isRequired: templateQuestions.isRequired,
      orderIndex: templateQuestions.orderIndex,
    })
    .from(templateQuestions)
    .where(eq(templateQuestions.templateId, id))
    .orderBy(templateQuestions.orderIndex)

  return { ...template, questions }
}
