import { sql } from 'drizzle-orm'
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Auth.js tables (required by @auth/drizzle-adapter)
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image: text('image'),
  passwordHash: text('password_hash'),
})

export const accounts = pgTable(
  'accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  account => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
)

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
})

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  vt => [primaryKey({ columns: [vt.identifier, vt.token] })],
)

// ---------------------------------------------------------------------------
// User profiles (onboarding data for LLM personalization)
// ---------------------------------------------------------------------------

export const profiles = pgTable('profiles', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),

  // About You
  displayName: text('display_name').notNull(),
  birthday: text('birthday'),
  pronouns: text('pronouns'),

  // Love & Connection
  loveLang: text('love_lang'),
  interests: text('interests'), // JSON stringified array

  // Goals
  goals: text('goals'), // JSON stringified array

  // Metadata
  onboardingCompleted: boolean('onboarding_completed').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
})

// ---------------------------------------------------------------------------
// Partnerships (partner connection system)
// ---------------------------------------------------------------------------

export const partnershipStatusEnum = pgEnum('partnership_status', [
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'dissolved',
])

export const partnerships = pgTable(
  'partnerships',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    inviterId: text('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    inviteeId: text('invitee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    status: partnershipStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  },
  table => [
    uniqueIndex('unique_active_pair')
      .on(
        sql`LEAST(${table.inviterId}, ${table.inviteeId})`,
        sql`GREATEST(${table.inviterId}, ${table.inviteeId})`,
      )
      .where(sql`${table.status} IN ('pending', 'accepted')`),
  ],
)

// ---------------------------------------------------------------------------
// Check-in templates (reusable question sets for check-ins)
// ---------------------------------------------------------------------------

export const checkInTemplates = pgTable('check_in_templates', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),

  partnershipId: text('partnership_id').references(() => partnerships.id, {
    onDelete: 'cascade',
  }),

  createdById: text('created_by_id').references(() => users.id, {
    onDelete: 'cascade',
  }),

  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),

  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
})

export const templateQuestions = pgTable('template_questions', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),

  templateId: text('template_id')
    .notNull()
    .references(() => checkInTemplates.id, { onDelete: 'cascade' }),

  questionText: text('question_text').notNull(),
  isRequired: boolean('is_required').notNull().default(true),
  orderIndex: integer('order_index').notNull(),

  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
})
