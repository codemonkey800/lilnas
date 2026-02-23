import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Placeholder table — replace with your actual schema
// ---------------------------------------------------------------------------

export const examples = pgTable('examples', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
})
