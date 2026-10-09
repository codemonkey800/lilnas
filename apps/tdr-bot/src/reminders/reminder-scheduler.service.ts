import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { Cron, Interval } from '@nestjs/schedule'
import { Client } from 'discord.js'

import { Reminder } from 'src/db/schema'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'

import {
  DUE_BATCH_SIZE,
  FINISHED_RETENTION_DAYS,
  MAX_LATE_DELIVERY_MS,
  REMINDER_TICK_MS,
} from './reminder.constants'
import { ReminderRepository } from './reminder.repository'
import { ReminderDeliveryService } from './reminder-delivery.service'
import { nextCronRun } from './schedule'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Polls the database for due reminders and hands them to
 * {@link ReminderDeliveryService}. All schedule state lives in the
 * `reminder` table (`nextRunAt`), so nothing is lost across restarts.
 */
@Injectable()
export class ReminderSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ReminderSchedulerService.name)
  private ticking = false

  constructor(
    private readonly repository: ReminderRepository,
    private readonly delivery: ReminderDeliveryService,
    private readonly metrics: TdrBotMetricsService,
    private readonly client: Client,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcile()
    await this.refreshActiveGauge()
  }

  @Interval(REMINDER_TICK_MS)
  async tick(): Promise<void> {
    if (this.ticking || !this.client.isReady()) return
    this.ticking = true
    try {
      const now = new Date()
      const due = await this.repository.listDue(now, DUE_BATCH_SIZE)
      if (due.length === 0) return

      let delivered = 0
      for (const reminder of due) {
        if (await this.process(reminder, now)) delivered++
      }
      this.logger.log(
        { due: due.length, delivered },
        'Reminder tick processed due reminders',
      )
      await this.refreshActiveGauge()
    } catch (err) {
      this.logger.error({ err }, 'Reminder tick failed')
    } finally {
      this.ticking = false
    }
  }

  /** Gives active rows without a `nextRunAt` (new, migrated) their first run. */
  async reconcile(): Promise<void> {
    const rows = await this.repository.listActiveWithoutNextRun()
    const now = new Date()

    for (const row of rows) {
      try {
        await this.reconcileRow(row, now)
      } catch (err) {
        this.logger.error({ err, id: row.id }, 'Failed to reconcile reminder')
      }
    }
    if (rows.length > 0) {
      this.logger.log({ count: rows.length }, 'Reconciled reminders')
    }
  }

  @Cron('0 4 * * *')
  async prune(): Promise<void> {
    const cutoff = new Date(Date.now() - FINISHED_RETENTION_DAYS * DAY_MS)
    const deleted = await this.repository.deleteFinishedBefore(cutoff)
    if (deleted > 0) {
      this.logger.log({ deleted }, 'Pruned finished reminders')
    }
  }

  private async reconcileRow(row: Reminder, now: Date): Promise<void> {
    if (row.isRecurring) {
      const next = row.cronExpression
        ? nextCronRun(row.cronExpression, now, row.endsAt)
        : null
      await this.repository.update(
        row.id,
        next ? { nextRunAt: next } : { status: 'completed', nextRunAt: null },
      )
      return
    }

    const at = row.scheduledAt
    if (at && at.getTime() > now.getTime()) {
      await this.repository.update(row.id, { nextRunAt: at })
    } else if (!at || now.getTime() - at.getTime() > MAX_LATE_DELIVERY_MS) {
      await this.repository.update(row.id, {
        status: 'missed',
        nextRunAt: null,
      })
      this.metrics.reminderFailed('missed')
    } else {
      await this.repository.update(row.id, { nextRunAt: now })
    }
  }

  /** Delivers one reminder, then advances it whatever the outcome. */
  private async process(reminder: Reminder, now: Date): Promise<boolean> {
    const result = await this.delivery.deliver(
      reminder,
      reminder.nextRunAt ?? now,
    )
    if (result.ok) {
      this.metrics.reminderDelivered()
      this.logger.log(
        { id: reminder.id, userId: reminder.userId },
        'Reminder delivered',
      )
    } else {
      this.metrics.reminderFailed(result.reason)
      this.logger.warn(
        { id: reminder.id, reason: result.reason },
        'Reminder delivery failed',
      )
    }

    const next =
      reminder.isRecurring && reminder.cronExpression
        ? nextCronRun(reminder.cronExpression, now, reminder.endsAt)
        : null
    try {
      const advanced = reminder.nextRunAt
        ? await this.repository.advanceIfActive(
            reminder.id,
            reminder.nextRunAt,
            {
              status: next ? 'active' : 'completed',
              nextRunAt: next,
              lastRunAt: now,
              runCount: reminder.runCount + 1,
            },
          )
        : null
      if (!advanced) {
        this.logger.warn(
          { id: reminder.id },
          'Reminder changed during delivery; skipped advance',
        )
      }
    } catch (err) {
      this.logger.error({ err, id: reminder.id }, 'Failed to advance reminder')
    }
    return result.ok
  }

  private async refreshActiveGauge(): Promise<void> {
    try {
      this.metrics.setActiveReminders(await this.repository.countActiveByType())
    } catch (err) {
      this.logger.error({ err }, 'Failed to refresh active reminders gauge')
    }
  }
}
