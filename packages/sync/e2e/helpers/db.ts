import crypto from 'node:crypto'

import bcrypt from 'bcryptjs'
import { Pool } from 'pg'

// ---------------------------------------------------------------------------
// Connection
//
// Because Playwright runs all specs sequentially in a single worker, the pool
// is a process-level singleton. We lazily create it and never explicitly close
// it — Node will clean up when the worker process exits.
// ---------------------------------------------------------------------------

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://sync_e2e:testpass@localhost:5434/sync_e2e'

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: DATABASE_URL })
  }
  return pool
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/** Delete all rows from every application table (order matters for FKs). */
export async function truncateAll(): Promise<void> {
  const p = getPool()
  // Check-in related tables (deepest children first)
  await p.query('DELETE FROM action_items')
  await p.query('DELETE FROM check_in_responses')
  await p.query('DELETE FROM check_in_questions')
  await p.query('DELETE FROM check_ins')
  await p.query('DELETE FROM template_questions')
  await p.query('DELETE FROM check_in_templates')
  // Partnership & user tables
  await p.query('DELETE FROM partnerships')
  await p.query('DELETE FROM profiles')
  await p.query('DELETE FROM accounts')
  await p.query('DELETE FROM sessions')
  await p.query('DELETE FROM verification_tokens')
  await p.query('DELETE FROM users')
}

// ---------------------------------------------------------------------------
// Seed helpers — Users, profiles, partnerships
// ---------------------------------------------------------------------------

interface SeedUserOptions {
  id?: string
  email?: string
  password?: string
  name?: string
}

interface SeedUserResult {
  id: string
  email: string
}

/**
 * Insert a user with a bcrypt-hashed password.
 * Returns the user's `id` and `email`.
 */
export async function seedUser(
  opts: SeedUserOptions = {},
): Promise<SeedUserResult> {
  const id = opts.id ?? crypto.randomUUID()
  const email = opts.email ?? `${id.slice(0, 8)}@e2e.test`
  const password = opts.password ?? 'testpassword123'
  const name = opts.name ?? null

  const passwordHash = await bcrypt.hash(password, 10)

  await getPool().query(
    `INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)`,
    [id, email, name, passwordHash],
  )

  return { id, email }
}

interface SeedProfileOptions {
  displayName?: string
  birthday?: string | null
  pronouns?: string | null
  loveLang?: string | null
  interests?: string[] | null
  goals?: string[] | null
  onboardingCompleted?: boolean
}

/**
 * Insert a profile for a given user.
 * Defaults to `onboardingCompleted: true` since most E2E tests need
 * fully-onboarded users.
 */
export async function seedProfile(
  userId: string,
  opts: SeedProfileOptions = {},
): Promise<{ id: string }> {
  const id = crypto.randomUUID()
  const displayName = opts.displayName ?? 'Test User'
  const birthday = opts.birthday ?? null
  const pronouns = opts.pronouns ?? null
  const loveLang = opts.loveLang ?? null
  const interests =
    opts.interests !== undefined ? JSON.stringify(opts.interests) : null
  const goals = opts.goals !== undefined ? JSON.stringify(opts.goals) : null
  const onboardingCompleted = opts.onboardingCompleted ?? true

  await getPool().query(
    `INSERT INTO profiles
       (id, user_id, display_name, birthday, pronouns, love_lang, interests, goals, onboarding_completed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      userId,
      displayName,
      birthday,
      pronouns,
      loveLang,
      interests,
      goals,
      onboardingCompleted,
    ],
  )

  return { id }
}

/**
 * Insert a partnership between two users.
 */
export async function seedPartnership(
  inviterId: string,
  inviteeId: string,
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'dissolved',
): Promise<{ id: string }> {
  const id = crypto.randomUUID()

  await getPool().query(
    `INSERT INTO partnerships (id, inviter_id, invitee_id, status) VALUES ($1, $2, $3, $4)`,
    [id, inviterId, inviteeId, status],
  )

  return { id }
}

// ---------------------------------------------------------------------------
// Seed helpers — Templates
// ---------------------------------------------------------------------------

interface SeedTemplateOptions {
  name?: string
  description?: string | null
  isSystem?: boolean
  createdById?: string | null
}

/**
 * Insert a check-in template.
 */
export async function seedTemplate(
  partnershipId: string | null,
  opts: SeedTemplateOptions = {},
): Promise<{ id: string }> {
  const id = crypto.randomUUID()

  await getPool().query(
    `INSERT INTO check_in_templates
       (id, partnership_id, created_by_id, name, description, is_system)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      partnershipId,
      opts.createdById ?? null,
      opts.name ?? 'E2E Template',
      opts.description ?? null,
      opts.isSystem ?? false,
    ],
  )

  return { id }
}

interface SeedTemplateQuestionOptions {
  questionText?: string
  isRequired?: boolean
  orderIndex?: number
}

/**
 * Insert a template question.
 */
export async function seedTemplateQuestion(
  templateId: string,
  opts: SeedTemplateQuestionOptions = {},
): Promise<{ id: string }> {
  const id = crypto.randomUUID()

  await getPool().query(
    `INSERT INTO template_questions
       (id, template_id, question_text, is_required, order_index)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      id,
      templateId,
      opts.questionText ?? 'E2E question?',
      opts.isRequired ?? true,
      opts.orderIndex ?? 0,
    ],
  )

  return { id }
}

// ---------------------------------------------------------------------------
// Seed helpers — Check-ins
// ---------------------------------------------------------------------------

interface SeedCheckInOptions {
  title?: string
  templateId?: string
  status?: 'draft' | 'in_progress' | 'completed'
  startedAt?: Date | null
  completedAt?: Date | null
  pendingTransition?: string | null
  pendingTransitionById?: string | null
}

/**
 * Insert a check-in directly (for pre-seeding test state).
 * If no templateId is provided, one will be auto-created.
 */
export async function seedCheckIn(
  partnershipId: string,
  createdById: string,
  opts: SeedCheckInOptions = {},
): Promise<{ id: string; templateId: string }> {
  let templateId = opts.templateId
  if (!templateId) {
    const tpl = await seedTemplate(partnershipId, {
      name: 'Auto Template',
      createdById,
    })
    templateId = tpl.id
  }

  const id = crypto.randomUUID()

  await getPool().query(
    `INSERT INTO check_ins
       (id, partnership_id, template_id, title, status, started_at, completed_at,
        pending_transition, pending_transition_by_id, created_by_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      partnershipId,
      templateId,
      opts.title ?? 'E2E Check-in',
      opts.status ?? 'draft',
      opts.startedAt ?? null,
      opts.completedAt ?? null,
      opts.pendingTransition ?? null,
      opts.pendingTransitionById ?? null,
      createdById,
    ],
  )

  return { id, templateId }
}

interface SeedCheckInQuestionOptions {
  questionText?: string
  isRequired?: boolean
  orderIndex?: number
  createdById?: string | null
}

/**
 * Insert a check-in question directly.
 */
export async function seedCheckInQuestion(
  checkInId: string,
  opts: SeedCheckInQuestionOptions = {},
): Promise<{ id: string }> {
  const id = crypto.randomUUID()

  await getPool().query(
    `INSERT INTO check_in_questions
       (id, check_in_id, question_text, is_required, order_index, created_by_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      checkInId,
      opts.questionText ?? 'E2E check-in question?',
      opts.isRequired ?? true,
      opts.orderIndex ?? 0,
      opts.createdById ?? null,
    ],
  )

  return { id }
}

interface SeedCheckInResponseOptions {
  responseText?: string | null
  isDraft?: boolean
}

/**
 * Insert a check-in response directly.
 */
export async function seedCheckInResponse(
  checkInQuestionId: string,
  userId: string,
  opts: SeedCheckInResponseOptions = {},
): Promise<{ id: string }> {
  const id = crypto.randomUUID()

  await getPool().query(
    `INSERT INTO check_in_responses
       (id, check_in_question_id, user_id, response_text, is_draft)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      id,
      checkInQuestionId,
      userId,
      opts.responseText ?? null,
      opts.isDraft ?? true,
    ],
  )

  return { id }
}

// ---------------------------------------------------------------------------
// Seed helpers — Action items
// ---------------------------------------------------------------------------

interface SeedActionItemOptions {
  description?: string
  ownerType?: 'individual' | 'both'
  ownerId?: string | null
  status?: 'open' | 'in_progress' | 'completed'
}

/**
 * Insert an action item directly.
 */
export async function seedActionItem(
  checkInId: string,
  checkInQuestionId: string,
  createdById: string,
  opts: SeedActionItemOptions = {},
): Promise<{ id: string }> {
  const id = crypto.randomUUID()

  await getPool().query(
    `INSERT INTO action_items
       (id, check_in_id, check_in_question_id, created_by_id,
        description, owner_type, owner_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      checkInId,
      checkInQuestionId,
      createdById,
      opts.description ?? 'E2E action item',
      opts.ownerType ?? 'individual',
      opts.ownerId ?? createdById,
      opts.status ?? 'open',
    ],
  )

  return { id }
}
