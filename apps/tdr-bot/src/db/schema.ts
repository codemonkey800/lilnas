import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/** Postgres table storing both one-time and recurring reminders. */
export const reminders = pgTable('reminder', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  guildId: text('guild_id').notNull().default(''),
  what: text('what').notNull(),
  isRecurring: boolean('is_recurring').notNull().default(false),
  cronExpression: text('cron_expression'),
  scheduledAt: timestamp('scheduled_at', { mode: 'date' }),
  dayDescription: text('day_description').notNull(),
  timeDescription: text('time_description').notNull(),
  actionType: text('action_type').notNull().default('default'),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
})

/** Row type returned when selecting from the reminders table. */
export type Reminder = typeof reminders.$inferSelect

/** Insert payload accepted when creating a new reminder row. */
export type NewReminder = typeof reminders.$inferInsert
