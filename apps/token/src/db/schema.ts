import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/** Postgres table storing API tokens for registered applications. */
export const tokens = pgTable('token', {
  id: text('id').primaryKey(),
  appSlug: text('app_slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  tokenHash: text('token_hash').notNull(),
  tokenPrefix: text('token_prefix').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
})

export type Token = typeof tokens.$inferSelect
export type NewToken = typeof tokens.$inferInsert
