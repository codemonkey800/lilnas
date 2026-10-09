import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { NewReminder, Reminder, ReminderSource } from 'src/db/schema'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'

import {
  MAX_REMINDER_WHAT_LENGTH,
  MAX_REMINDERS_PER_USER,
} from './reminder.constants'
import { ReminderListFilter, ReminderRepository } from './reminder.repository'
import { ReminderActionType } from './reminder.types'
import {
  describeSchedule,
  nextCronRun,
  nextRunFor,
  previewRuns,
  ReminderSchedule,
  validateCron,
} from './schedule'

export type ReminderErrorCode =
  | 'limit_reached'
  | 'invalid_cron'
  | 'cron_too_frequent'
  | 'in_past'
  | 'ends_before_start'
  | 'invalid_what'
  | 'not_found'
  | 'forbidden'
  | 'not_active'

export class ReminderError extends Error {
  constructor(
    readonly code: ReminderErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ReminderError'
  }
}

export interface CreateReminderInput {
  userId: string
  userName: string
  guildId: string
  what: string
  schedule: ReminderSchedule
  /** Empty or omitted falls back to {@link describeSchedule}. */
  scheduleDescription?: string
  channelId?: string | null
  targetUserIds?: string[]
  actionType?: ReminderActionType
  /** Defaults to `'discord'`. */
  source?: ReminderSource
}

export type UpdateReminderInput = Partial<
  Pick<
    CreateReminderInput,
    | 'what'
    | 'schedule'
    | 'scheduleDescription'
    | 'channelId'
    | 'targetUserIds'
    | 'actionType'
  >
>

const DEFAULT_PREVIEW_COUNT = 5

const uniqueIds = (ids: string[] | undefined) => [
  ...new Set((ids ?? []).filter(Boolean)),
]

const typeOf = (r: Pick<Reminder, 'isRecurring'>) =>
  r.isRecurring ? 'recurring' : 'one_time'

function scheduleColumns(
  schedule: ReminderSchedule,
): Pick<
  NewReminder,
  'isRecurring' | 'cronExpression' | 'scheduledAt' | 'endsAt'
> {
  return schedule.kind === 'once'
    ? {
        isRecurring: false,
        cronExpression: null,
        scheduledAt: schedule.at,
        endsAt: null,
      }
    : {
        isRecurring: true,
        cronExpression: schedule.cron,
        scheduledAt: null,
        endsAt: schedule.endsAt ?? null,
      }
}

/** Validation and CRUD for reminders; delivery is driven by the scheduler. */
@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name)

  constructor(
    private readonly repository: ReminderRepository,
    private readonly metrics: TdrBotMetricsService,
  ) {}

  async create(input: CreateReminderInput): Promise<Reminder> {
    const now = new Date()
    const what = this.validateWhat(input.what)
    this.validateSchedule(input.schedule, now)

    const source = input.source ?? 'discord'
    if (source === 'discord') {
      const active = await this.repository.countActiveCreatedBy(input.userId)
      if (active >= MAX_REMINDERS_PER_USER) {
        throw new ReminderError(
          'limit_reached',
          `Reminder limit reached (max ${MAX_REMINDERS_PER_USER} per user)`,
        )
      }
    }

    const columns = scheduleColumns(input.schedule)
    const created = await this.repository.insert({
      id: nanoid(),
      userId: input.userId,
      userName: input.userName,
      guildId: input.guildId,
      what,
      ...columns,
      scheduleDescription:
        input.scheduleDescription?.trim() || describeSchedule(input.schedule),
      channelId: input.channelId ?? null,
      targetUserIds: uniqueIds(input.targetUserIds),
      actionType: input.actionType ?? ReminderActionType.Default,
      status: 'active',
      source,
      nextRunAt: nextRunFor(
        {
          isRecurring: columns.isRecurring ?? false,
          cronExpression: columns.cronExpression ?? null,
          scheduledAt: columns.scheduledAt ?? null,
          endsAt: columns.endsAt ?? null,
        },
        now,
      ),
    })

    this.logger.log(
      {
        id: created.id,
        userId: created.userId,
        isRecurring: created.isRecurring,
        what: created.what,
      },
      'Reminder created',
    )
    this.metrics.reminderCreated(typeOf(created))
    return created
  }

  /** Active reminders only; recomputes `nextRunAt` when the schedule changes. */
  async update(id: string, patch: UpdateReminderInput): Promise<Reminder> {
    const existing = await this.repository.findById(id)
    if (!existing) throw new ReminderError('not_found', 'Reminder not found')
    if (existing.status !== 'active') {
      throw new ReminderError('not_active', 'Reminder is no longer active')
    }

    const now = new Date()
    const changes: Partial<NewReminder> = {}

    if (patch.what !== undefined) changes.what = this.validateWhat(patch.what)
    if (patch.channelId !== undefined) changes.channelId = patch.channelId
    if (patch.targetUserIds !== undefined) {
      changes.targetUserIds = uniqueIds(patch.targetUserIds)
    }
    if (patch.actionType !== undefined) changes.actionType = patch.actionType

    if (patch.schedule) {
      this.validateSchedule(patch.schedule, now)
      const columns = scheduleColumns(patch.schedule)
      Object.assign(changes, columns)
      changes.scheduleDescription =
        patch.scheduleDescription?.trim() || describeSchedule(patch.schedule)
      changes.nextRunAt = nextRunFor(
        {
          isRecurring: columns.isRecurring ?? false,
          cronExpression: columns.cronExpression ?? null,
          scheduledAt: columns.scheduledAt ?? null,
          endsAt: columns.endsAt ?? null,
        },
        now,
      )
    } else if (patch.scheduleDescription !== undefined) {
      changes.scheduleDescription =
        patch.scheduleDescription.trim() || existing.scheduleDescription || ''
    }

    const updated = await this.repository.update(id, changes)
    if (!updated) throw new ReminderError('not_found', 'Reminder not found')
    this.logger.log({ id, fields: Object.keys(changes) }, 'Reminder updated')
    return updated
  }

  /**
   * With `opts.userId` the caller must be the creator or the target,
   * otherwise `forbidden`.
   */
  async cancel(id: string, opts: { userId?: string } = {}): Promise<Reminder> {
    const existing = await this.repository.findById(id)
    if (!existing) throw new ReminderError('not_found', 'Reminder not found')
    if (
      opts.userId &&
      opts.userId !== existing.userId &&
      !existing.targetUserIds.includes(opts.userId)
    ) {
      throw new ReminderError(
        'forbidden',
        'Only the creator or target can cancel this reminder',
      )
    }
    if (existing.status !== 'active') {
      throw new ReminderError('not_active', 'Reminder is no longer active')
    }

    const cancelled = await this.repository.update(id, {
      status: 'cancelled',
      cancelledAt: new Date(),
      nextRunAt: null,
    })
    if (!cancelled) throw new ReminderError('not_found', 'Reminder not found')

    this.logger.log({ id, userId: opts.userId }, 'Reminder cancelled')
    this.metrics.reminderCancelled(typeOf(cancelled))
    return cancelled
  }

  /** Cancels every active reminder the user created or is the target of. */
  async cancelAllForUser(userId: string): Promise<number> {
    const active = await this.repository.listActiveForUser(userId)
    let cancelled = 0
    for (const reminder of active) {
      try {
        await this.cancel(reminder.id)
        cancelled++
      } catch (err) {
        if (!(err instanceof ReminderError)) throw err
      }
    }
    return cancelled
  }

  get(id: string): Promise<Reminder | null> {
    return this.repository.findById(id)
  }

  /** Active reminders the user created or is the target of, soonest first. */
  listForUser(userId: string): Promise<Reminder[]> {
    return this.repository.listActiveForUser(userId)
  }

  list(filter: ReminderListFilter): Promise<Reminder[]> {
    return this.repository.list(filter)
  }

  /** Validates like {@link create} and returns the upcoming run times. */
  preview(schedule: ReminderSchedule, count = DEFAULT_PREVIEW_COUNT): Date[] {
    const now = new Date()
    this.validateSchedule(schedule, now)
    return previewRuns(schedule, now, count)
  }

  private validateWhat(what: string): string {
    const trimmed = what.trim()
    if (trimmed.length < 1 || trimmed.length > MAX_REMINDER_WHAT_LENGTH) {
      throw new ReminderError(
        'invalid_what',
        `Reminder text must be 1-${MAX_REMINDER_WHAT_LENGTH} characters`,
      )
    }
    return trimmed
  }

  private validateSchedule(schedule: ReminderSchedule, now: Date): void {
    if (schedule.kind === 'once') {
      if (schedule.at.getTime() <= now.getTime()) {
        throw new ReminderError('in_past', 'Reminder time is in the past')
      }
      return
    }

    const check = validateCron(schedule.cron)
    if (!check.ok) {
      throw check.reason === 'invalid'
        ? new ReminderError('invalid_cron', 'Invalid cron expression')
        : new ReminderError(
            'cron_too_frequent',
            'Recurring reminders must be more than a minute apart',
          )
    }

    const first = nextCronRun(schedule.cron, now)
    if (!first) {
      throw new ReminderError('invalid_cron', 'Cron expression never runs')
    }
    if (
      schedule.endsAt &&
      (schedule.endsAt.getTime() <= now.getTime() ||
        schedule.endsAt.getTime() < first.getTime())
    ) {
      throw new ReminderError(
        'ends_before_start',
        'End date must be in the future and after the first run',
      )
    }
  }
}
