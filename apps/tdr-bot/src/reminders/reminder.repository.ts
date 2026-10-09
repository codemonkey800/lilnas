import { Injectable } from '@nestjs/common'
import {
  and,
  arrayContains,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  or,
  SQL,
  sql,
} from 'drizzle-orm'

import { DrizzleService } from 'src/db/drizzle.service'
import { NewReminder, Reminder, reminders, ReminderStatus } from 'src/db/schema'

export interface ReminderListFilter {
  status?: ReminderStatus | 'all'
  userId?: string
  limit?: number
}

const FINISHED_STATUSES: ReminderStatus[] = ['completed', 'cancelled', 'missed']

/** Drizzle access to the `reminder` table; business rules live in the service. */
@Injectable()
export class ReminderRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async insert(row: NewReminder): Promise<Reminder> {
    const [created] = await this.drizzle.db
      .insert(reminders)
      .values(row)
      .returning()
    return created
  }

  async findById(id: string): Promise<Reminder | null> {
    const [found] = await this.drizzle.db
      .select()
      .from(reminders)
      .where(eq(reminders.id, id))
    return found ?? null
  }

  /** Defaults to active reminders; ordered by next run, then newest created. */
  async list(filter: ReminderListFilter): Promise<Reminder[]> {
    const status = filter.status ?? 'active'
    const conditions: SQL[] = []
    if (status !== 'all') conditions.push(eq(reminders.status, status))
    if (filter.userId) conditions.push(eq(reminders.userId, filter.userId))

    const query = this.drizzle.db
      .select()
      .from(reminders)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(
        sql`${reminders.nextRunAt} ASC NULLS LAST`,
        desc(reminders.createdAt),
      )
    return filter.limit ? query.limit(filter.limit) : query
  }

  /** Active reminders the user created or is the target of. */
  async listActiveForUser(userId: string): Promise<Reminder[]> {
    return this.drizzle.db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.status, 'active'),
          or(
            eq(reminders.userId, userId),
            arrayContains(reminders.targetUserIds, [userId]),
          ),
        ),
      )
      .orderBy(
        sql`${reminders.nextRunAt} ASC NULLS LAST`,
        desc(reminders.createdAt),
      )
  }

  async countActiveCreatedBy(userId: string): Promise<number> {
    const [row] = await this.drizzle.db
      .select({ value: count() })
      .from(reminders)
      .where(and(eq(reminders.status, 'active'), eq(reminders.userId, userId)))
    return Number(row?.value ?? 0)
  }

  /** Active reminders whose next run is at or before `now`, oldest first. */
  async listDue(now: Date, limit: number): Promise<Reminder[]> {
    return this.drizzle.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.status, 'active'), lte(reminders.nextRunAt, now)))
      .orderBy(asc(reminders.nextRunAt))
      .limit(limit)
  }

  /** Active reminders that have no computed next run yet (e.g. after boot). */
  async listActiveWithoutNextRun(): Promise<Reminder[]> {
    return this.drizzle.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.status, 'active'), isNull(reminders.nextRunAt)))
  }

  /** Applies `patch`, always bumping `updatedAt`. Null when the id is unknown. */
  async update(
    id: string,
    patch: Partial<NewReminder>,
  ): Promise<Reminder | null> {
    const [updated] = await this.drizzle.db
      .update(reminders)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(reminders.id, id))
      .returning()
    return updated ?? null
  }

  /**
   * Applies `patch` only while the row is still active with the `nextRunAt`
   * the caller read, so a concurrent cancel or schedule edit is not
   * overwritten. Null when the row changed (or is unknown).
   */
  async advanceIfActive(
    id: string,
    expectedNextRunAt: Date,
    patch: Partial<NewReminder>,
  ): Promise<Reminder | null> {
    const [updated] = await this.drizzle.db
      .update(reminders)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(reminders.id, id),
          eq(reminders.status, 'active'),
          eq(reminders.nextRunAt, expectedNextRunAt),
        ),
      )
      .returning()
    return updated ?? null
  }

  async countActiveByType(): Promise<{ recurring: number; oneTime: number }> {
    const rows = await this.drizzle.db
      .select({ isRecurring: reminders.isRecurring, value: count() })
      .from(reminders)
      .where(eq(reminders.status, 'active'))
      .groupBy(reminders.isRecurring)
    const countFor = (recurring: boolean) =>
      Number(rows.find(r => r.isRecurring === recurring)?.value ?? 0)
    return { recurring: countFor(true), oneTime: countFor(false) }
  }

  /** Deletes finished reminders last updated before `cutoff`; returns the count. */
  async deleteFinishedBefore(cutoff: Date): Promise<number> {
    const deleted = await this.drizzle.db
      .delete(reminders)
      .where(
        and(
          inArray(reminders.status, FINISHED_STATUSES),
          lt(reminders.updatedAt, cutoff),
        ),
      )
      .returning({ id: reminders.id })
    return deleted.length
  }
}
