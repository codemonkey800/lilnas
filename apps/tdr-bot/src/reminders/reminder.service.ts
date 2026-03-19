import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'
import { CronJob } from 'cron'
import { and, eq } from 'drizzle-orm'

import { DrizzleService } from 'src/db/drizzle.service'
import { NewReminder, Reminder, reminders } from 'src/db/schema'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'

import {
  MAX_PENDING_DELIVERIES,
  MAX_REMINDERS_PER_USER,
  MAX_TIMEOUT_MS,
} from './reminder.constants'

/** Minimum allowed interval for recurring reminders (1 minute). */
const MIN_CRON_INTERVAL_MS = 60_000

/**
 * Core service responsible for CRUD operations on reminders and
 * their runtime scheduling via `@nestjs/schedule`.
 *
 * On module init, all persisted reminders are reloaded from the
 * database and re-scheduled. Delivery is delegated to a callback
 * registered by {@link ReminderDeliveryService} via
 * {@link setDeliveryFunction}; reminders that fire before the
 * callback is registered are queued in memory.
 */
@Injectable()
export class ReminderService implements OnModuleInit {
  private readonly logger = new Logger(ReminderService.name)

  private deliverFn: ((reminder: Reminder) => Promise<void>) | null = null
  private readonly pendingDeliveries: Reminder[] = []

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly drizzle: DrizzleService,
    private readonly metrics: TdrBotMetricsService,
  ) {}

  /**
   * Registers the function used to deliver a reminder to the user.
   * Any reminders that fired while no callback was registered are
   * flushed immediately.
   */
  setDeliveryFunction(fn: (reminder: Reminder) => Promise<void>): void {
    this.deliverFn = fn
    const queued = this.pendingDeliveries.splice(0)
    for (const reminder of queued) {
      void this.deliver(reminder)
    }
  }

  /** Reloads all persisted reminders from the database and re-schedules them. */
  async onModuleInit(): Promise<void> {
    this.logger.log('Loading reminders from database')
    const all = await this.drizzle.db.select().from(reminders)
    this.logger.log({ count: all.length }, 'Loaded reminders from database')

    for (const reminder of all) {
      await this.scheduleReminder(reminder)
    }

    this.logger.log('All reminders re-scheduled')
  }

  /**
   * Persists a new reminder and schedules it for delivery.
   *
   * @param data - The reminder fields to insert.
   * @returns The created reminder row.
   * @throws If the user has already reached {@link MAX_REMINDERS_PER_USER}.
   */
  async create(data: NewReminder): Promise<Reminder> {
    const existing = await this.listForUser(data.userId)
    if (existing.length >= MAX_REMINDERS_PER_USER) {
      throw new Error(
        `Reminder limit reached (max ${MAX_REMINDERS_PER_USER} per user)`,
      )
    }

    const [created] = await this.drizzle.db
      .insert(reminders)
      .values(data)
      .returning()

    this.logger.log(
      {
        id: created.id,
        userId: created.userId,
        isRecurring: created.isRecurring,
        what: created.what,
      },
      'Reminder created',
    )

    await this.scheduleReminder(created)

    this.metrics.reminderCreated(created.isRecurring ? 'recurring' : 'one_time')

    return created
  }

  /** Returns all active reminders belonging to the given user. */
  async listForUser(userId: string): Promise<Reminder[]> {
    return this.drizzle.db
      .select()
      .from(reminders)
      .where(eq(reminders.userId, userId))
  }

  /**
   * Cancels a reminder by deleting it from the database and
   * removing its cron job or timeout from the scheduler.
   *
   * @returns `true` if a matching reminder was found and deleted.
   */
  async cancel(id: string, userId: string): Promise<boolean> {
    const [deleted] = await this.drizzle.db
      .delete(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
      .returning()

    if (!deleted) return false

    this.unschedule(id, deleted.isRecurring)

    this.logger.log({ id, userId: deleted.userId }, 'Reminder cancelled')

    this.metrics.reminderCancelled(
      deleted.isRecurring ? 'recurring' : 'one_time',
    )

    return true
  }

  /** Records a delivery failure metric (called by {@link ReminderDeliveryService}). */
  recordDeliveryFailure(reason: string): void {
    this.metrics.reminderFailed(reason)
  }

  private async findById(id: string): Promise<Reminder | null> {
    const [found] = await this.drizzle.db
      .select()
      .from(reminders)
      .where(eq(reminders.id, id))
    return found ?? null
  }

  private async deleteAfterDelivery(
    id: string,
    isRecurring: boolean,
  ): Promise<void> {
    if (!isRecurring) {
      await this.drizzle.db.delete(reminders).where(eq(reminders.id, id))
      this.metrics.reminderActiveDecrement('one_time')
    }
    this.metrics.reminderDelivered()
  }

  /**
   * Validates that a cron expression does not fire more often than
   * once per minute to prevent runaway scheduling.
   */
  private isSafeCronFrequency(cronExpression: string): boolean {
    try {
      const job = new CronJob(cronExpression, () => {})
      const dates = job.nextDates(2)
      if (dates.length < 2) return false
      const intervalMs = dates[1].toMillis() - dates[0].toMillis()
      return intervalMs >= MIN_CRON_INTERVAL_MS
    } catch {
      return false
    }
  }

  /**
   * Routes a reminder to the correct scheduler: cron for recurring,
   * chained `setTimeout` for one-time. Past one-time reminders are
   * deleted immediately.
   */
  private async scheduleReminder(reminder: Reminder): Promise<void> {
    if (reminder.isRecurring && reminder.cronExpression) {
      if (!this.isSafeCronFrequency(reminder.cronExpression)) {
        this.logger.warn(
          { id: reminder.id, cron: reminder.cronExpression },
          'Rejected recurring reminder with sub-minute cron frequency',
        )
        return
      }
      try {
        const id = reminder.id
        const job = new CronJob(reminder.cronExpression, async () => {
          try {
            const fresh = await this.findById(id)
            if (fresh) await this.deliver(fresh)
          } catch (err) {
            this.logger.error({ id, err }, 'Recurring reminder tick failed')
            this.recordDeliveryFailure('cron_tick_error')
          }
        })
        this.schedulerRegistry.addCronJob(reminder.id, job)
        job.start()
        this.logger.log(
          { id: reminder.id, cron: reminder.cronExpression },
          'Scheduled recurring reminder',
        )
      } catch (err) {
        this.logger.error(
          { id: reminder.id, err },
          'Failed to schedule recurring reminder',
        )
      }
    } else if (!reminder.isRecurring && reminder.scheduledAt) {
      const delay = reminder.scheduledAt.getTime() - Date.now()
      if (delay <= 0) {
        this.logger.warn(
          { id: reminder.id },
          'One-time reminder is in the past, deleting',
        )
        await this.drizzle.db
          .delete(reminders)
          .where(eq(reminders.id, reminder.id))
        this.metrics.reminderActiveDecrement('one_time')
        return
      }
      this.scheduleTimeout(reminder, delay)
    }
  }

  /**
   * Schedules a one-time reminder delivery via `setTimeout`.
   *
   * Because Node.js limits `setTimeout` to ~24.8 days ({@link MAX_TIMEOUT_MS}),
   * delays exceeding that limit are broken into intermediate hops that
   * re-schedule themselves until the target time is reached.
   */
  private scheduleTimeout(reminder: Reminder, delay: number): void {
    const effectiveDelay = Math.min(delay, MAX_TIMEOUT_MS)
    const isIntermediate = delay > MAX_TIMEOUT_MS

    const t = setTimeout(async () => {
      try {
        if (isIntermediate) {
          try {
            this.schedulerRegistry.deleteTimeout(reminder.id)
          } catch {
            // Expected when timeout hasn't been registered yet during chaining
          }
          const remaining = (reminder.scheduledAt?.getTime() ?? 0) - Date.now()
          if (remaining > 0) {
            this.scheduleTimeout(reminder, remaining)
          } else {
            await this.deliver(reminder)
          }
        } else {
          await this.deliver(reminder)
        }
      } catch (err) {
        this.logger.error({ id: reminder.id, err }, 'Timeout callback failed')
        this.recordDeliveryFailure('timeout_callback_error')
      }
    }, effectiveDelay)

    try {
      this.schedulerRegistry.deleteTimeout(reminder.id)
    } catch (err) {
      this.logger.debug(
        { id: reminder.id, err },
        'Timeout not yet registered, skipping delete',
      )
    }
    this.schedulerRegistry.addTimeout(reminder.id, t)

    this.logger.log(
      { id: reminder.id, delayMs: effectiveDelay, isIntermediate },
      'Scheduled one-time reminder timeout',
    )
  }

  /**
   * Invokes the registered delivery function for a reminder.
   * If no delivery function is registered yet, queues the reminder
   * (up to {@link MAX_PENDING_DELIVERIES}).
   */
  private async deliver(reminder: Reminder): Promise<void> {
    if (!this.deliverFn) {
      if (this.pendingDeliveries.length >= MAX_PENDING_DELIVERIES) {
        this.logger.error(
          { id: reminder.id },
          'Pending delivery queue full, dropping reminder',
        )
        this.recordDeliveryFailure('pending_queue_full')
        return
      }
      this.logger.warn(
        { id: reminder.id },
        'Delivery function not yet registered, queueing reminder',
      )
      this.pendingDeliveries.push(reminder)
      return
    }
    try {
      await this.deliverFn(reminder)
      await this.deleteAfterDelivery(reminder.id, reminder.isRecurring)
    } catch (err) {
      this.logger.error({ id: reminder.id, err }, 'Reminder delivery failed')
      this.recordDeliveryFailure('delivery_error')
    }
  }

  private unschedule(id: string, isRecurring: boolean): void {
    try {
      if (isRecurring) {
        this.schedulerRegistry.deleteCronJob(id)
      } else {
        this.schedulerRegistry.deleteTimeout(id)
      }
    } catch (err) {
      this.logger.debug(
        { id, err },
        'Schedule entry not found, may have already fired',
      )
    }
  }
}
