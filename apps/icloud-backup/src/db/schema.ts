import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { TERMINAL_STATES } from 'src/shared/contract'

// Nothing here ever holds an Apple password, a verification code or a session
// cookie. Cookies live on disk under STATE_ROOT; the others are never stored.

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' })

/** One row per signed-in lilnas user who has set up a backup. */
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  lilnasUserId: text('lilnas_user_id').notNull().unique(),
  lilnasEmail: text('lilnas_email').notNull(),
  /** Folder name under PHOTOS_ROOT. */
  slug: text('slug').notNull().unique(),
  appleId: text('apple_id').unique(),
  immichUserId: text('immich_user_id'),
  immichLibraryId: text('immich_library_id'),
  immichEmail: text('immich_email'),
  immichCreatedByUs: boolean('immich_created_by_us').notNull().default(false),
  totalItems: integer('total_items').notNull().default(0),
  totalBytes: bigint('total_bytes', { mode: 'number' }).notNull().default(0),
  lastBackupAt: timestamptz('last_backup_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
})

const terminalStatesSql = sql.raw(TERMINAL_STATES.map(s => `'${s}'`).join(', '))

/** One backup attempt. At most one per account may be non-terminal. */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    state: text('state').notNull(),
    authError: text('auth_error'),
    totalItems: integer('total_items'),
    downloadedItems: integer('downloaded_items').notNull().default(0),
    skippedItems: integer('skipped_items').notNull().default(0),
    downloadedBytes: bigint('downloaded_bytes', { mode: 'number' })
      .notNull()
      .default(0),
    currentFile: text('current_file'),
    attempt: integer('attempt').notNull().default(0),
    retryAt: timestamptz('retry_at'),
    errorCode: text('error_code'),
    errorDetail: text('error_detail'),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  t => [
    uniqueIndex('jobs_one_active_per_account')
      .on(t.accountId)
      .where(sql`${t.state} not in (${terminalStatesSql})`),
    index('jobs_account_started_idx').on(t.accountId, t.startedAt),
  ],
)

/** Append-only log of what happened during a job, shown in the UI. */
export const jobEvents = pgTable(
  'job_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    at: timestamptz('at').notNull().defaultNow(),
    type: text('type').notNull(),
    message: text('message').notNull(),
  },
  t => [index('job_events_job_idx').on(t.jobId, t.id)],
)

export type Account = typeof accounts.$inferSelect
export type Job = typeof jobs.$inferSelect
export type JobEvent = typeof jobEvents.$inferSelect
