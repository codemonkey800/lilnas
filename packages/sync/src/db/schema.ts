import { integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core'

export const counters = pgTable('counters', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  value: integer('value').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
