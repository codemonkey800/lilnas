import { eq, sql } from 'drizzle-orm'
import type { Mock } from 'vitest'

import { testDb } from 'src/__tests__/integration-setup'
import {
  actionItems,
  checkInQuestions,
  checkInResponses,
  checkIns,
  checkInTemplates,
  partnerships,
  profiles,
  templateQuestions,
  users,
} from 'src/db/schema'

// Re-export for convenience in test files
export { testDb }

// ---------------------------------------------------------------------------
// Auth mock helper
// ---------------------------------------------------------------------------

/**
 * Import the mocked auth module and configure it to return a session
 * for the given userId. Call with `null` to simulate unauthenticated.
 */
export async function mockAuthAs(userId: string | null): Promise<void> {
  // auth() has overloaded signatures in NextAuth v5 (session getter +
  // middleware). Cast through unknown to a plain Mock so mockResolvedValue
  // works cleanly against the mocked module.
  const authModule = await import('src/auth')
  const mockedAuth = authModule.auth as unknown as Mock

  if (userId) {
    mockedAuth.mockResolvedValue({
      user: { id: userId },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    })
  } else {
    mockedAuth.mockResolvedValue(null)
  }
}

// ---------------------------------------------------------------------------
// Table truncation
// ---------------------------------------------------------------------------

const TABLES_IN_DELETE_ORDER = [
  actionItems,
  checkInResponses,
  checkInQuestions,
  checkIns,
  templateQuestions,
  checkInTemplates,
  partnerships,
  profiles,
  users,
] as const

/**
 * Truncate all application tables between tests. Uses DELETE (not TRUNCATE)
 * to avoid issues with table locks and CASCADE in parallel tests.
 */
export async function truncateAll(): Promise<void> {
  for (const table of TABLES_IN_DELETE_ORDER) {
    await testDb.delete(table)
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

interface CreateUserOptions {
  id?: string
  email?: string
  name?: string
  passwordHash?: string
}

/**
 * Insert a user into the test database and return the created row.
 */
export async function createTestUser(
  overrides: CreateUserOptions = {},
): Promise<{ id: string; email: string | null }> {
  const id = overrides.id ?? crypto.randomUUID()
  const email = overrides.email ?? `${id.slice(0, 8)}@test.com`

  const rows = await testDb
    .insert(users)
    .values({
      id,
      email,
      name: overrides.name ?? null,
      passwordHash: overrides.passwordHash ?? null,
    })
    .returning({ id: users.id, email: users.email })

  return rows[0]!
}

interface CreateProfileOptions {
  displayName?: string
  birthday?: string
  pronouns?: string
  loveLang?: string
  interests?: string
  goals?: string
  onboardingCompleted?: boolean
}

/**
 * Insert a profile for the given user. Returns the created profile id.
 */
export async function createTestProfile(
  userId: string,
  overrides: CreateProfileOptions = {},
): Promise<{ id: string }> {
  const rows = await testDb
    .insert(profiles)
    .values({
      userId,
      displayName: overrides.displayName ?? 'Test User',
      birthday: overrides.birthday ?? null,
      pronouns: overrides.pronouns ?? null,
      loveLang: overrides.loveLang ?? null,
      interests: overrides.interests ?? null,
      goals: overrides.goals ?? null,
      onboardingCompleted: overrides.onboardingCompleted ?? false,
    })
    .returning({ id: profiles.id })

  return rows[0]!
}

/**
 * Insert a partnership directly (for setting up test preconditions).
 */
export async function createTestPartnership(
  inviterId: string,
  inviteeId: string,
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'dissolved',
): Promise<{ id: string }> {
  const rows = await testDb
    .insert(partnerships)
    .values({ inviterId, inviteeId, status })
    .returning({ id: partnerships.id })

  return rows[0]!
}

/**
 * Read a partnership row by id.
 */
export async function getPartnership(
  id: string,
): Promise<{ status: string } | undefined> {
  const [row] = await testDb
    .select({ status: partnerships.status })
    .from(partnerships)
    .where(sql`${partnerships.id} = ${id}`)
    .limit(1)

  return row
}

// ---------------------------------------------------------------------------
// Template factory helpers
// ---------------------------------------------------------------------------

interface CreateTemplateOptions {
  name?: string
  description?: string | null
  isSystem?: boolean
  createdById?: string | null
}

/**
 * Insert a check-in template directly (for setting up test preconditions).
 * If `partnershipId` is omitted and `isSystem` is true, creates a system template.
 */
export async function createTestTemplate(
  partnershipId: string | null = null,
  overrides: CreateTemplateOptions = {},
): Promise<{ id: string }> {
  const rows = await testDb
    .insert(checkInTemplates)
    .values({
      partnershipId,
      createdById: overrides.createdById ?? null,
      name: overrides.name ?? 'Test Template',
      description: overrides.description ?? null,
      isSystem: overrides.isSystem ?? false,
    })
    .returning({ id: checkInTemplates.id })

  return rows[0]!
}

interface CreateTemplateQuestionOptions {
  questionText?: string
  isRequired?: boolean
  orderIndex?: number
}

/**
 * Insert a template question directly (for setting up test preconditions).
 */
export async function createTestTemplateQuestion(
  templateId: string,
  overrides: CreateTemplateQuestionOptions = {},
): Promise<{ id: string }> {
  const rows = await testDb
    .insert(templateQuestions)
    .values({
      templateId,
      questionText: overrides.questionText ?? 'Test question?',
      isRequired: overrides.isRequired ?? true,
      orderIndex: overrides.orderIndex ?? 0,
    })
    .returning({ id: templateQuestions.id })

  return rows[0]!
}

/**
 * Read a template row by id.
 */
export async function getTemplate(id: string): Promise<
  | {
      id: string
      name: string
      description: string | null
      isSystem: boolean
      partnershipId: string | null
      createdById: string | null
    }
  | undefined
> {
  const [row] = await testDb
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

  return row
}

/**
 * Read all questions for a template, ordered by orderIndex.
 */
export async function getTemplateQuestions(templateId: string): Promise<
  Array<{
    id: string
    questionText: string
    isRequired: boolean
    orderIndex: number
  }>
> {
  return testDb
    .select({
      id: templateQuestions.id,
      questionText: templateQuestions.questionText,
      isRequired: templateQuestions.isRequired,
      orderIndex: templateQuestions.orderIndex,
    })
    .from(templateQuestions)
    .where(eq(templateQuestions.templateId, templateId))
    .orderBy(templateQuestions.orderIndex)
}

// ---------------------------------------------------------------------------
// Check-in factory helpers
// ---------------------------------------------------------------------------

interface CreateCheckInOptions {
  title?: string
  templateId?: string
  status?: 'draft' | 'in_progress' | 'completed'
  startedAt?: Date | null
  completedAt?: Date | null
  pendingTransition?: string | null
  pendingTransitionById?: string | null
}

/**
 * Insert a check-in directly (for setting up test preconditions).
 * Auto-creates a template if none is provided.
 */
export async function createTestCheckIn(
  partnershipId: string,
  createdById: string,
  overrides: CreateCheckInOptions = {},
): Promise<{ id: string }> {
  let templateId = overrides.templateId
  if (!templateId) {
    const tpl = await createTestTemplate(partnershipId, {
      name: 'Auto Template',
    })
    templateId = tpl.id
  }

  const rows = await testDb
    .insert(checkIns)
    .values({
      partnershipId,
      createdById,
      title: overrides.title ?? 'Test Check-in',
      templateId,
      status: overrides.status ?? 'draft',
      startedAt: overrides.startedAt ?? null,
      completedAt: overrides.completedAt ?? null,
      pendingTransition: overrides.pendingTransition ?? null,
      pendingTransitionById: overrides.pendingTransitionById ?? null,
    })
    .returning({ id: checkIns.id })

  return rows[0]!
}

/**
 * Read a check-in row by id.
 */
export async function getCheckIn(id: string): Promise<
  | {
      id: string
      title: string
      status: string
      partnershipId: string
      templateId: string | null
      createdById: string
      startedAt: Date | null
      completedAt: Date | null
      pendingTransition: string | null
      pendingTransitionById: string | null
    }
  | undefined
> {
  const [row] = await testDb
    .select({
      id: checkIns.id,
      title: checkIns.title,
      status: checkIns.status,
      partnershipId: checkIns.partnershipId,
      templateId: checkIns.templateId,
      createdById: checkIns.createdById,
      startedAt: checkIns.startedAt,
      completedAt: checkIns.completedAt,
      pendingTransition: checkIns.pendingTransition,
      pendingTransitionById: checkIns.pendingTransitionById,
    })
    .from(checkIns)
    .where(eq(checkIns.id, id))
    .limit(1)

  return row
}

interface CreateCheckInQuestionOptions {
  questionText?: string
  isRequired?: boolean
  orderIndex?: number
  createdById?: string | null
}

/**
 * Insert a check-in question directly (for setting up test preconditions).
 */
export async function createTestCheckInQuestion(
  checkInId: string,
  overrides: CreateCheckInQuestionOptions = {},
): Promise<{ id: string }> {
  const rows = await testDb
    .insert(checkInQuestions)
    .values({
      checkInId,
      questionText: overrides.questionText ?? 'Test check-in question?',
      isRequired: overrides.isRequired ?? true,
      orderIndex: overrides.orderIndex ?? 0,
      createdById: overrides.createdById ?? null,
    })
    .returning({ id: checkInQuestions.id })

  return rows[0]!
}

/**
 * Read all questions for a check-in, ordered by orderIndex.
 */
export async function getCheckInQuestions(checkInId: string): Promise<
  Array<{
    id: string
    questionText: string
    isRequired: boolean
    orderIndex: number
    createdById: string | null
  }>
> {
  return testDb
    .select({
      id: checkInQuestions.id,
      questionText: checkInQuestions.questionText,
      isRequired: checkInQuestions.isRequired,
      orderIndex: checkInQuestions.orderIndex,
      createdById: checkInQuestions.createdById,
    })
    .from(checkInQuestions)
    .where(eq(checkInQuestions.checkInId, checkInId))
    .orderBy(checkInQuestions.orderIndex)
}

interface CreateCheckInResponseOptions {
  responseText?: string | null
  isDraft?: boolean
}

/**
 * Insert a check-in response directly (for setting up test preconditions).
 */
export async function createTestCheckInResponse(
  checkInQuestionId: string,
  userId: string,
  overrides: CreateCheckInResponseOptions = {},
): Promise<{ id: string }> {
  const rows = await testDb
    .insert(checkInResponses)
    .values({
      checkInQuestionId,
      userId,
      responseText: overrides.responseText ?? null,
      isDraft: overrides.isDraft ?? true,
    })
    .returning({ id: checkInResponses.id })

  return rows[0]!
}

/**
 * Read all responses for a check-in question.
 */
export async function getCheckInResponses(checkInQuestionId: string): Promise<
  Array<{
    id: string
    userId: string
    responseText: string | null
    isDraft: boolean
  }>
> {
  return testDb
    .select({
      id: checkInResponses.id,
      userId: checkInResponses.userId,
      responseText: checkInResponses.responseText,
      isDraft: checkInResponses.isDraft,
    })
    .from(checkInResponses)
    .where(eq(checkInResponses.checkInQuestionId, checkInQuestionId))
}

// ---------------------------------------------------------------------------
// Action item factory helpers
// ---------------------------------------------------------------------------

interface CreateActionItemOptions {
  description?: string
  ownerType?: 'individual' | 'both'
  ownerId?: string | null
  status?: 'open' | 'in_progress' | 'completed'
  dueDate?: Date | null
  completedAt?: Date | null
}

/**
 * Insert an action item directly (for setting up test preconditions).
 */
export async function createTestActionItem(
  checkInId: string,
  checkInQuestionId: string,
  createdById: string,
  overrides: CreateActionItemOptions = {},
): Promise<{ id: string }> {
  const rows = await testDb
    .insert(actionItems)
    .values({
      checkInId,
      checkInQuestionId,
      createdById,
      description: overrides.description ?? 'Test action item',
      ownerType: overrides.ownerType ?? 'individual',
      ownerId: 'ownerId' in overrides ? overrides.ownerId : createdById,
      status: overrides.status ?? 'open',
      dueDate: overrides.dueDate ?? null,
      completedAt: overrides.completedAt ?? null,
    })
    .returning({ id: actionItems.id })

  return rows[0]!
}

/**
 * Read an action item row by id.
 */
export async function getActionItem(id: string): Promise<
  | {
      id: string
      checkInId: string
      checkInQuestionId: string
      description: string
      ownerType: string
      ownerId: string | null
      createdById: string
      status: string
      completedAt: Date | null
    }
  | undefined
> {
  const [row] = await testDb
    .select({
      id: actionItems.id,
      checkInId: actionItems.checkInId,
      checkInQuestionId: actionItems.checkInQuestionId,
      description: actionItems.description,
      ownerType: actionItems.ownerType,
      ownerId: actionItems.ownerId,
      createdById: actionItems.createdById,
      status: actionItems.status,
      completedAt: actionItems.completedAt,
    })
    .from(actionItems)
    .where(eq(actionItems.id, id))
    .limit(1)

  return row
}
