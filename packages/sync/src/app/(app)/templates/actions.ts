'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { auth } from 'src/auth'
import { db } from 'src/db'
import { checkInTemplates, templateQuestions } from 'src/db/schema'

import {
  getActivePartnership,
  isPartnershipMember,
  validateName,
  validateQuestions,
  validateTemplateInput,
} from './helpers'
import type {
  ActionResult,
  CreateTemplateInput,
  UpdateTemplateInput,
} from './types'

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * P2-A1: Create a new custom template with questions.
 */
export async function createTemplate(
  data: CreateTemplateInput,
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
      error: 'You must have an active partnership to create templates.',
    }
  }

  const validationError = validateTemplateInput(data.name, data.questions)
  if (validationError) {
    return { success: false, error: validationError }
  }

  try {
    const templateId = await db.transaction(async tx => {
      const rows = await tx
        .insert(checkInTemplates)
        .values({
          name: data.name.trim(),
          description: data.description?.trim() || null,
          isSystem: false,
          partnershipId: activePartnership.id,
          createdById: userId,
        })
        .returning({ id: checkInTemplates.id })

      const newTemplateId = rows[0]!.id

      await tx.insert(templateQuestions).values(
        data.questions.map((q, index) => ({
          templateId: newTemplateId,
          questionText: q.questionText.trim(),
          isRequired: q.isRequired ?? true,
          orderIndex: index,
        })),
      )

      return newTemplateId
    })

    revalidatePath('/templates')

    return { success: true, templateId }
  } catch {
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}

/**
 * P2-A2: Update a custom template's name, description, and/or questions.
 */
export async function updateTemplate(
  id: string,
  data: UpdateTemplateInput,
): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  const userId = session.user.id

  // Fetch the template to check ownership
  const [template] = await db
    .select({
      id: checkInTemplates.id,
      isSystem: checkInTemplates.isSystem,
      partnershipId: checkInTemplates.partnershipId,
    })
    .from(checkInTemplates)
    .where(eq(checkInTemplates.id, id))
    .limit(1)

  if (!template) {
    return { success: false, error: 'Template not found.' }
  }

  if (template.isSystem) {
    return { success: false, error: 'System templates cannot be edited.' }
  }

  if (!template.partnershipId) {
    return { success: false, error: 'Template not found.' }
  }

  const isMember = await isPartnershipMember(template.partnershipId, userId)
  if (!isMember) {
    return {
      success: false,
      error: 'You are not a member of this partnership.',
    }
  }

  // Validate inputs if provided
  if (data.name !== undefined) {
    const nameError = validateName(data.name)
    if (nameError) return { success: false, error: nameError }
  }

  if (data.questions !== undefined) {
    const questionsError = validateQuestions(data.questions)
    if (questionsError) return { success: false, error: questionsError }
  }

  try {
    await db.transaction(async tx => {
      // Update template fields
      const updates: Partial<typeof checkInTemplates.$inferInsert> = {
        updatedAt: new Date(),
      }
      if (data.name !== undefined) updates.name = data.name.trim()
      if (data.description !== undefined) {
        updates.description = data.description?.trim() || null
      }

      await tx
        .update(checkInTemplates)
        .set(updates)
        .where(eq(checkInTemplates.id, id))

      // Replace questions if provided
      if (data.questions !== undefined) {
        await tx
          .delete(templateQuestions)
          .where(eq(templateQuestions.templateId, id))

        await tx.insert(templateQuestions).values(
          data.questions.map((q, index) => ({
            templateId: id,
            questionText: q.questionText.trim(),
            isRequired: q.isRequired ?? true,
            orderIndex: index,
          })),
        )
      }
    })

    revalidatePath('/templates')

    return { success: true, templateId: id }
  } catch {
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}

/**
 * P2-A3: Delete a custom template.
 */
export async function deleteTemplate(id: string): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  const userId = session.user.id

  const [template] = await db
    .select({
      id: checkInTemplates.id,
      isSystem: checkInTemplates.isSystem,
      partnershipId: checkInTemplates.partnershipId,
    })
    .from(checkInTemplates)
    .where(eq(checkInTemplates.id, id))
    .limit(1)

  if (!template) {
    return { success: false, error: 'Template not found.' }
  }

  if (template.isSystem) {
    return { success: false, error: 'System templates cannot be deleted.' }
  }

  if (!template.partnershipId) {
    return { success: false, error: 'Template not found.' }
  }

  const isMember = await isPartnershipMember(template.partnershipId, userId)
  if (!isMember) {
    return {
      success: false,
      error: 'You are not a member of this partnership.',
    }
  }

  try {
    // Cascade delete handles templateQuestions automatically
    await db.delete(checkInTemplates).where(eq(checkInTemplates.id, id))

    revalidatePath('/templates')

    return { success: true }
  } catch {
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}

/**
 * P2-A4: Duplicate a template (system or custom).
 */
export async function duplicateTemplate(id: string): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in.' }
  }

  const userId = session.user.id
  const activePartnership = await getActivePartnership(userId)

  if (!activePartnership) {
    return {
      success: false,
      error: 'You must have an active partnership to duplicate templates.',
    }
  }

  // Fetch the source template
  const [source] = await db
    .select({
      id: checkInTemplates.id,
      name: checkInTemplates.name,
      description: checkInTemplates.description,
      isSystem: checkInTemplates.isSystem,
      partnershipId: checkInTemplates.partnershipId,
    })
    .from(checkInTemplates)
    .where(eq(checkInTemplates.id, id))
    .limit(1)

  if (!source) {
    return { success: false, error: 'Template not found.' }
  }

  // Authorization: system templates can be duplicated by anyone;
  // custom templates only by partnership members
  if (!source.isSystem && source.partnershipId) {
    const isMember = await isPartnershipMember(source.partnershipId, userId)
    if (!isMember) {
      return { success: false, error: 'Template not found.' }
    }
  }

  // Fetch source questions
  const sourceQuestions = await db
    .select({
      questionText: templateQuestions.questionText,
      isRequired: templateQuestions.isRequired,
      orderIndex: templateQuestions.orderIndex,
    })
    .from(templateQuestions)
    .where(eq(templateQuestions.templateId, id))
    .orderBy(templateQuestions.orderIndex)

  try {
    const baseName = source.name.replace(/ \(Copy\)$/, '')

    const newTemplateId = await db.transaction(async tx => {
      const rows = await tx
        .insert(checkInTemplates)
        .values({
          name: `${baseName} (Copy)`,
          description: source.description,
          isSystem: false,
          partnershipId: activePartnership.id,
          createdById: userId,
        })
        .returning({ id: checkInTemplates.id })

      const newId = rows[0]!.id

      if (sourceQuestions.length > 0) {
        await tx.insert(templateQuestions).values(
          sourceQuestions.map(q => ({
            templateId: newId,
            questionText: q.questionText,
            isRequired: q.isRequired,
            orderIndex: q.orderIndex,
          })),
        )
      }

      return newId
    })

    revalidatePath('/templates')

    return { success: true, templateId: newTemplateId }
  } catch {
    return {
      success: false,
      error: 'Something went wrong. Please try again.',
    }
  }
}
