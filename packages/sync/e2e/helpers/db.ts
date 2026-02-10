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
  await p.query('DELETE FROM partnerships')
  await p.query('DELETE FROM profiles')
  await p.query('DELETE FROM accounts')
  await p.query('DELETE FROM sessions')
  await p.query('DELETE FROM verification_tokens')
  await p.query('DELETE FROM users')
}

// ---------------------------------------------------------------------------
// Seed helpers
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
