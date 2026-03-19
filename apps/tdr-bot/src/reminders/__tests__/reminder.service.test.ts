import { SchedulerRegistry } from '@nestjs/schedule'
import { Test } from '@nestjs/testing'
import { CronJob } from 'cron'

import { createMockMetricsService } from 'src/__tests__/test-utils'
import { DrizzleService } from 'src/db/drizzle.service'
import { Reminder } from 'src/db/schema'
import {
  MAX_PENDING_DELIVERIES,
  MAX_REMINDERS_PER_USER,
  MAX_TIMEOUT_MS,
} from 'src/reminders/reminder.constants'
import { ReminderService } from 'src/reminders/reminder.service'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'

// ─── Schema mock ──────────────────────────────────────────────────────────────

jest.mock('src/db/schema', () => ({
  reminders: {},
}))

// ─── External dependency mocks ────────────────────────────────────────────────

jest.mock('cron', () => ({
  CronJob: jest.fn(),
}))

jest.mock('drizzle-orm', () => ({
  eq: jest.fn(() => 'mock-eq-condition'),
  and: jest.fn((...args: unknown[]) => args),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createTestReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'reminder-1',
    userId: 'user-1',
    guildId: 'guild-1',
    what: 'test reminder',
    isRecurring: false,
    cronExpression: null,
    scheduledAt: new Date(Date.now() + 60_000),
    dayDescription: 'tomorrow',
    timeDescription: '9:00 AM',
    channelId: null,
    targetUserId: null,
    actionType: 'default',
    createdAt: new Date(),
    ...overrides,
  }
}

/**
 * Creates a mock for `db.select().from().where()` chains.
 * The object returned by `from()` is thenable (for `await db.select().from()`)
 * AND has a `where()` method (for `await db.select().from().where()`).
 */
function makeSelectChain(result: unknown[] = []) {
  const fromResult = {
    where: jest.fn(() => Promise.resolve(result)),
    then: (
      resolve: (v: unknown[]) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) =>
      Promise.resolve(result).catch(reject),
  }
  return { from: jest.fn(() => fromResult) }
}

/**
 * Creates a mock for `db.insert().values().returning()` chains.
 */
function makeInsertChain(result: unknown[] = []) {
  return {
    values: jest.fn(() => ({
      returning: jest.fn(() => Promise.resolve(result)),
    })),
  }
}

/**
 * Creates a mock for `db.delete().where()` chains.
 * The `where()` result is thenable AND has `returning()`.
 */
function makeDeleteChain(returningResult: unknown[] = []) {
  const whereResult = {
    returning: jest.fn(() => Promise.resolve(returningResult)),
    then: (
      resolve: (v: undefined) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(undefined).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) =>
      Promise.resolve(undefined).catch(reject),
  }
  return { where: jest.fn(() => whereResult) }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ReminderService', () => {
  let service: ReminderService
  let mockSchedulerRegistry: jest.Mocked<SchedulerRegistry>
  let mockCronJobInstance: { start: jest.Mock; stop: jest.Mock }
  let mockDb: { select: jest.Mock; insert: jest.Mock; delete: jest.Mock }
  let mockMetrics: jest.Mocked<TdrBotMetricsService>

  afterEach(() => {
    jest.clearAllTimers()
  })

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
      delete: jest.fn(),
    }

    mockCronJobInstance = { start: jest.fn(), stop: jest.fn() }
    ;(CronJob as unknown as jest.Mock).mockImplementation(
      (_expr: string, callback: () => void) => ({
        ...mockCronJobInstance,
        _callback: callback,
        nextDates: jest
          .fn()
          .mockReturnValue([
            { toMillis: () => Date.now() + 1_000 },
            { toMillis: () => Date.now() + 62_000 },
          ]),
      }),
    )

    mockSchedulerRegistry = {
      addCronJob: jest.fn(),
      deleteCronJob: jest.fn(),
      addTimeout: jest.fn(),
      deleteTimeout: jest.fn(),
    } as unknown as jest.Mocked<SchedulerRegistry>

    // Default: no existing reminders on startup
    mockDb.select.mockReturnValue(makeSelectChain([]))
    mockDb.insert.mockReturnValue(makeInsertChain([]))
    mockDb.delete.mockReturnValue(makeDeleteChain([]))

    const mockDrizzleService = { db: mockDb } as unknown as DrizzleService
    mockMetrics = createMockMetricsService()

    const module = await Test.createTestingModule({
      providers: [
        ReminderService,
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
        { provide: DrizzleService, useValue: mockDrizzleService },
        { provide: TdrBotMetricsService, useValue: mockMetrics },
      ],
    }).compile()

    service = module.get(ReminderService)
  })

  // ── onModuleInit ─────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('loads all reminders from the database on startup', async () => {
      const existing = [
        createTestReminder({ id: 'r1' }),
        createTestReminder({ id: 'r2' }),
      ]
      mockDb.select.mockReturnValue(makeSelectChain(existing))

      await service.onModuleInit()

      const { from } = mockDb.select.mock.results[0].value as ReturnType<
        typeof makeSelectChain
      >
      expect(from).toHaveBeenCalled()
    })

    it('schedules each loaded reminder', async () => {
      const futureTime = new Date(Date.now() + 60_000)
      const existing = [
        createTestReminder({ id: 'r1', scheduledAt: futureTime }),
        createTestReminder({ id: 'r2', scheduledAt: futureTime }),
      ]
      mockDb.select.mockReturnValue(makeSelectChain(existing))

      await service.onModuleInit()

      expect(mockSchedulerRegistry.addTimeout).toHaveBeenCalledTimes(2)
    })
  })

  // ── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('inserts the reminder into the database', async () => {
      const newReminder = createTestReminder()
      mockDb.insert.mockReturnValue(makeInsertChain([newReminder]))

      await service.create(newReminder)

      expect(mockDb.insert).toHaveBeenCalled()
    })

    it('returns the created reminder', async () => {
      const newReminder = createTestReminder()
      mockDb.insert.mockReturnValue(makeInsertChain([newReminder]))

      const result = await service.create(newReminder)

      expect(result).toEqual(newReminder)
    })

    it('schedules a timeout for a one-time reminder', async () => {
      const reminder = createTestReminder({
        isRecurring: false,
        scheduledAt: new Date(Date.now() + 60_000),
      })
      mockDb.insert.mockReturnValue(makeInsertChain([reminder]))

      await service.create(reminder)

      expect(mockSchedulerRegistry.addTimeout).toHaveBeenCalledWith(
        reminder.id,
        expect.any(Object),
      )
    })

    it('schedules a cron job for a recurring reminder', async () => {
      const reminder = createTestReminder({
        isRecurring: true,
        cronExpression: '0 9 * * 2',
        scheduledAt: null,
      })
      mockDb.insert.mockReturnValue(makeInsertChain([reminder]))

      await service.create(reminder)

      expect(mockSchedulerRegistry.addCronJob).toHaveBeenCalledWith(
        reminder.id,
        expect.anything(),
      )
      expect(mockCronJobInstance.start).toHaveBeenCalled()
    })

    it('increments the one_time metric for a one-time reminder', async () => {
      const reminder = createTestReminder({ isRecurring: false })
      mockDb.insert.mockReturnValue(makeInsertChain([reminder]))

      await service.create(reminder)

      expect(mockMetrics.reminderCreated).toHaveBeenCalledWith('one_time')
    })

    it('increments the recurring metric for a recurring reminder', async () => {
      const reminder = createTestReminder({
        isRecurring: true,
        cronExpression: '0 9 * * 2',
        scheduledAt: null,
      })
      mockDb.insert.mockReturnValue(makeInsertChain([reminder]))

      await service.create(reminder)

      expect(mockMetrics.reminderCreated).toHaveBeenCalledWith('recurring')
    })

    it('stores a reminder with a specific channelId', async () => {
      const reminder = createTestReminder({ channelId: '987654321012345678' })
      mockDb.insert.mockReturnValue(makeInsertChain([reminder]))

      const result = await service.create(reminder)

      expect(result.channelId).toBe('987654321012345678')
    })

    it('stores a reminder with channelId null when no channel is specified', async () => {
      const reminder = createTestReminder({ channelId: null })
      mockDb.insert.mockReturnValue(makeInsertChain([reminder]))

      const result = await service.create(reminder)

      expect(result.channelId).toBeNull()
    })

    it('throws when the user already has MAX_REMINDERS_PER_USER reminders', async () => {
      const existingReminders = Array.from(
        { length: MAX_REMINDERS_PER_USER },
        (_, i) => createTestReminder({ id: `existing-${i}` }),
      )
      mockDb.select.mockReturnValue(makeSelectChain(existingReminders))

      await expect(
        service.create(createTestReminder({ id: 'new-reminder' })),
      ).rejects.toThrow(`max ${MAX_REMINDERS_PER_USER}`)
    })
  })

  // ── listForUser ───────────────────────────────────────────────────────────

  describe('listForUser', () => {
    it('returns reminders for the given user', async () => {
      const userReminders = [
        createTestReminder({ id: 'r1', userId: 'user-42' }),
        createTestReminder({ id: 'r2', userId: 'user-42' }),
      ]
      const chain = makeSelectChain(userReminders)
      mockDb.select.mockReturnValue(chain)

      const result = await service.listForUser('user-42')

      expect(result).toEqual(userReminders)
      expect(chain.from).toHaveBeenCalled()
    })

    it('returns an empty array when the user has no reminders', async () => {
      mockDb.select.mockReturnValue(makeSelectChain([]))

      const result = await service.listForUser('user-99')

      expect(result).toEqual([])
    })
  })

  // ── cancel ────────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('returns true when the reminder is found and deleted', async () => {
      const reminder = createTestReminder()
      mockDb.delete.mockReturnValue(makeDeleteChain([reminder]))

      const result = await service.cancel(reminder.id, reminder.userId)

      expect(result).toBe(true)
    })

    it('returns false when no reminder is found', async () => {
      mockDb.delete.mockReturnValue(makeDeleteChain([]))

      const result = await service.cancel('non-existent', 'user-1')

      expect(result).toBe(false)
    })

    it('unschedules a recurring reminder', async () => {
      const reminder = createTestReminder({
        isRecurring: true,
        cronExpression: '0 9 * * 2',
      })
      mockDb.delete.mockReturnValue(makeDeleteChain([reminder]))

      await service.cancel(reminder.id, reminder.userId)

      expect(mockSchedulerRegistry.deleteCronJob).toHaveBeenCalledWith(
        reminder.id,
      )
    })

    it('unschedules a one-time reminder', async () => {
      const reminder = createTestReminder({ isRecurring: false })
      mockDb.delete.mockReturnValue(makeDeleteChain([reminder]))

      await service.cancel(reminder.id, reminder.userId)

      expect(mockSchedulerRegistry.deleteTimeout).toHaveBeenCalledWith(
        reminder.id,
      )
    })

    it('increments the cancelled metric', async () => {
      const reminder = createTestReminder()
      mockDb.delete.mockReturnValue(makeDeleteChain([reminder]))

      await service.cancel(reminder.id, reminder.userId)

      expect(mockMetrics.reminderCancelled).toHaveBeenCalledWith('one_time')
    })

    it('does not unschedule when no reminder is found', async () => {
      mockDb.delete.mockReturnValue(makeDeleteChain([]))

      await service.cancel('non-existent', 'user-1')

      expect(mockSchedulerRegistry.deleteCronJob).not.toHaveBeenCalled()
      expect(mockSchedulerRegistry.deleteTimeout).not.toHaveBeenCalled()
    })
  })

  // ── scheduling via create (covers scheduleReminder, scheduleTimeout, deleteAfterDelivery) ──

  describe('scheduling behavior via create()', () => {
    it('creates a CronJob for a recurring reminder', async () => {
      const reminder = createTestReminder({
        isRecurring: true,
        cronExpression: '0 9 * * 2',
        scheduledAt: null,
      })
      mockDb.insert.mockReturnValue(makeInsertChain([reminder]))

      await service.create(reminder)

      expect(CronJob).toHaveBeenCalledWith('0 9 * * 2', expect.any(Function))
      expect(mockSchedulerRegistry.addCronJob).toHaveBeenCalledWith(
        reminder.id,
        expect.anything(),
      )
      expect(mockCronJobInstance.start).toHaveBeenCalled()
    })

    it('skips cron scheduling when cron expression is missing', async () => {
      const reminder = createTestReminder({
        isRecurring: true,
        cronExpression: null,
      })
      mockDb.insert.mockReturnValue(makeInsertChain([reminder]))

      await service.create(reminder)

      expect(CronJob).not.toHaveBeenCalled()
    })

    it('rejects sub-minute cron expressions and does not schedule the reminder', async () => {
      // Configure CronJob mock to return dates < 60s apart for the validation call
      ;(CronJob as unknown as jest.Mock).mockImplementation(() => ({
        ...mockCronJobInstance,
        nextDates: jest.fn().mockReturnValue([
          { toMillis: () => Date.now() },
          { toMillis: () => Date.now() + 30_000 }, // 30s interval — below minimum
        ]),
      }))

      const reminder = createTestReminder({
        isRecurring: true,
        cronExpression: '*/30 * * * * *', // every 30 seconds
        scheduledAt: null,
      })
      mockDb.insert.mockReturnValue(makeInsertChain([reminder]))

      await service.create(reminder)

      // isSafeCronFrequency creates one CronJob for validation; the actual
      // scheduling CronJob should NOT be created since frequency is too high.
      expect(mockSchedulerRegistry.addCronJob).not.toHaveBeenCalled()
    })

    it('does not throw when CronJob constructor throws during scheduling', async () => {
      // First call: isSafeCronFrequency validation (returns safe interval)
      // Second call: actual scheduling (throws)
      ;(CronJob as unknown as jest.Mock)
        .mockImplementationOnce(() => ({
          nextDates: jest
            .fn()
            .mockReturnValue([
              { toMillis: () => Date.now() + 1_000 },
              { toMillis: () => Date.now() + 62_000 },
            ]),
        }))
        .mockImplementationOnce(() => {
          throw new Error('Invalid cron expression')
        })

      const reminder = createTestReminder({
        isRecurring: true,
        cronExpression: '0 9 * * 2',
        scheduledAt: null,
      })
      mockDb.insert.mockReturnValue(makeInsertChain([reminder]))

      await expect(service.create(reminder)).resolves.not.toThrow()
      expect(mockSchedulerRegistry.addCronJob).not.toHaveBeenCalled()
    })

    it('registers a setTimeout for a future one-time reminder', async () => {
      jest.useFakeTimers()
      const reminder = createTestReminder({
        isRecurring: false,
        scheduledAt: new Date(Date.now() + 60_000),
      })
      mockDb.insert.mockReturnValue(makeInsertChain([reminder]))

      await service.create(reminder)

      expect(mockSchedulerRegistry.addTimeout).toHaveBeenCalledWith(
        reminder.id,
        expect.any(Object),
      )
      jest.useRealTimers()
    })

    it('deletes past one-time reminders from the database on init', async () => {
      const pastReminder = createTestReminder({
        isRecurring: false,
        scheduledAt: new Date(Date.now() - 60_000),
      })
      mockDb.select.mockReturnValue(makeSelectChain([pastReminder]))

      await service.onModuleInit()

      expect(mockDb.delete).toHaveBeenCalled()
      expect(mockSchedulerRegistry.addTimeout).not.toHaveBeenCalled()
    })

    it('does not schedule when scheduledAt is null for a one-time reminder', async () => {
      const reminder = createTestReminder({
        isRecurring: false,
        scheduledAt: null,
      })
      mockDb.insert.mockReturnValue(makeInsertChain([reminder]))

      await service.create(reminder)

      expect(mockSchedulerRegistry.addTimeout).not.toHaveBeenCalled()
    })

    it('deletes one-time reminder from DB after successful delivery', async () => {
      const reminder = createTestReminder({ isRecurring: false })
      mockDb.insert.mockReturnValue(makeInsertChain([reminder]))
      mockDb.select.mockReturnValue(makeSelectChain([reminder]))

      const mockDeliverFn = jest.fn().mockResolvedValue(undefined)
      service.setDeliveryFunction(mockDeliverFn)

      await service.create(reminder)

      // Trigger the cron/timeout callback via the deliver path
      await (
        service as unknown as { deliver: (r: Reminder) => Promise<void> }
      ).deliver(reminder)

      expect(mockDb.delete).toHaveBeenCalled()
    })

    it('does not delete recurring reminder from DB after delivery', async () => {
      const reminder = createTestReminder({
        isRecurring: true,
        cronExpression: '0 9 * * 2',
      })
      mockDb.insert.mockReturnValue(makeInsertChain([reminder]))

      const mockDeliverFn = jest.fn().mockResolvedValue(undefined)
      service.setDeliveryFunction(mockDeliverFn)

      await service.create(reminder)

      await (
        service as unknown as { deliver: (r: Reminder) => Promise<void> }
      ).deliver(reminder)

      expect(mockDb.delete).not.toHaveBeenCalled()
    })

    it('increments delivered metric after successful delivery', async () => {
      const reminder = createTestReminder()
      const mockDeliverFn = jest.fn().mockResolvedValue(undefined)
      service.setDeliveryFunction(mockDeliverFn)

      await (
        service as unknown as { deliver: (r: Reminder) => Promise<void> }
      ).deliver(reminder)

      expect(mockMetrics.reminderDelivered).toHaveBeenCalled()
    })
  })

  // ── scheduleTimeout chaining ────────────────────────────────────────────

  describe('scheduleTimeout chaining via create()', () => {
    it('caps the initial setTimeout at MAX_TIMEOUT_MS for far-future reminders', async () => {
      jest.useFakeTimers()
      const farFuture = new Date(Date.now() + MAX_TIMEOUT_MS + 10_000)
      const reminder = createTestReminder({ scheduledAt: farFuture })
      mockDb.insert.mockReturnValue(makeInsertChain([reminder]))

      await service.create(reminder)

      expect(mockSchedulerRegistry.addTimeout).toHaveBeenCalledWith(
        reminder.id,
        expect.any(Object),
      )
      jest.useRealTimers()
    })

    it('re-schedules when the intermediate timeout fires', async () => {
      jest.useFakeTimers()
      const extraMs = 10_000
      const farFuture = new Date(Date.now() + MAX_TIMEOUT_MS + extraMs)
      const reminder = createTestReminder({ scheduledAt: farFuture })
      mockDb.insert.mockReturnValue(makeInsertChain([reminder]))

      await service.create(reminder)

      expect(mockSchedulerRegistry.addTimeout).toHaveBeenCalledTimes(1)

      await jest.advanceTimersByTimeAsync(MAX_TIMEOUT_MS)

      expect(mockSchedulerRegistry.addTimeout).toHaveBeenCalledTimes(2)
      jest.useRealTimers()
    })
  })

  // ── setDeliveryFunction & deliver ─────────────────────────────────────────

  describe('setDeliveryFunction', () => {
    it('stores the delivery function for later use', async () => {
      const mockDeliverFn = jest.fn().mockResolvedValue(undefined)
      service.setDeliveryFunction(mockDeliverFn)

      await (
        service as unknown as { deliver: (r: Reminder) => Promise<void> }
      ).deliver(createTestReminder())

      expect(mockDeliverFn).toHaveBeenCalled()
    })
  })

  describe('deliver (private)', () => {
    it('calls the registered delivery function with the reminder', async () => {
      const reminder = createTestReminder()
      const mockDeliverFn = jest.fn().mockResolvedValue(undefined)
      service.setDeliveryFunction(mockDeliverFn)

      await (
        service as unknown as { deliver: (r: Reminder) => Promise<void> }
      ).deliver(reminder)

      expect(mockDeliverFn).toHaveBeenCalledWith(reminder)
    })

    it('calls deleteAfterDelivery after successful delivery', async () => {
      const reminder = createTestReminder()
      const mockDeliverFn = jest.fn().mockResolvedValue(undefined)
      service.setDeliveryFunction(mockDeliverFn)

      await (
        service as unknown as { deliver: (r: Reminder) => Promise<void> }
      ).deliver(reminder)

      // deleteAfterDelivery deletes from db for one-time reminders
      expect(mockDb.delete).toHaveBeenCalled()
    })

    it('queues the reminder when no delivery function is registered yet', async () => {
      const reminder = createTestReminder()

      await expect(
        (
          service as unknown as { deliver: (r: Reminder) => Promise<void> }
        ).deliver(reminder),
      ).resolves.not.toThrow()

      // Once a delivery function is registered, it should process the queued reminder
      const mockDeliverFn = jest.fn().mockResolvedValue(undefined)
      mockDb.delete.mockReturnValue(makeDeleteChain([reminder]))
      service.setDeliveryFunction(mockDeliverFn)
      expect(mockDeliverFn).toHaveBeenCalledWith(reminder)
    })

    it('records a delivery failure when the delivery function throws', async () => {
      const reminder = createTestReminder()
      const mockDeliverFn = jest
        .fn()
        .mockRejectedValue(new Error('network error'))
      service.setDeliveryFunction(mockDeliverFn)

      await (
        service as unknown as { deliver: (r: Reminder) => Promise<void> }
      ).deliver(reminder)

      expect(mockMetrics.reminderFailed).toHaveBeenCalledWith('delivery_error')
    })

    it('does not throw when the delivery function rejects', async () => {
      const reminder = createTestReminder()
      const mockDeliverFn = jest.fn().mockRejectedValue(new Error('fail'))
      service.setDeliveryFunction(mockDeliverFn)

      await expect(
        (
          service as unknown as { deliver: (r: Reminder) => Promise<void> }
        ).deliver(reminder),
      ).resolves.not.toThrow()
    })

    it('drops reminders and records a failure when the pending queue is full', async () => {
      // Fill the queue to MAX_PENDING_DELIVERIES without registering a deliverFn
      const deliverPrivate = (
        service as unknown as { deliver: (r: Reminder) => Promise<void> }
      ).deliver.bind(service)

      for (let i = 0; i < MAX_PENDING_DELIVERIES; i++) {
        await deliverPrivate(createTestReminder({ id: `queued-${i}` }))
      }

      // This one should overflow the queue
      await deliverPrivate(createTestReminder({ id: 'overflow' }))

      expect(mockMetrics.reminderFailed).toHaveBeenCalledWith(
        'pending_queue_full',
      )
    })

    it('flushes all queued reminders when setDeliveryFunction is called', async () => {
      const deliverPrivate = (
        service as unknown as { deliver: (r: Reminder) => Promise<void> }
      ).deliver.bind(service)

      const reminders = [
        createTestReminder({ id: 'q1' }),
        createTestReminder({ id: 'q2' }),
        createTestReminder({ id: 'q3' }),
      ]

      // Queue three reminders before deliverFn is set
      for (const r of reminders) {
        await deliverPrivate(r)
      }

      // Set up DB for deleteAfterDelivery (one-time reminders get deleted)
      for (const r of reminders) {
        mockDb.delete.mockReturnValue(makeDeleteChain([r]))
      }

      const mockDeliverFn = jest.fn().mockResolvedValue(undefined)
      service.setDeliveryFunction(mockDeliverFn)

      // Allow microtasks to settle
      await new Promise(resolve => setImmediate(resolve))

      expect(mockDeliverFn).toHaveBeenCalledTimes(reminders.length)
    })
  })

  // ── recordDeliveryFailure ─────────────────────────────────────────────────

  describe('recordDeliveryFailure', () => {
    it('increments the failure metric with the given reason', () => {
      service.recordDeliveryFailure('send_error')

      expect(mockMetrics.reminderFailed).toHaveBeenCalledWith('send_error')
    })
  })

  // ── CronJob callback integration ──────────────────────────────────────────

  describe('CronJob callback', () => {
    it('calls the delivery function when the cron job fires', async () => {
      const reminder = createTestReminder({
        isRecurring: true,
        cronExpression: '0 9 * * 2',
      })
      mockDb.insert.mockReturnValue(makeInsertChain([reminder]))
      // findById (called from the cron callback) needs to resolve the reminder
      mockDb.select.mockReturnValue(makeSelectChain([reminder]))
      const mockDeliverFn = jest.fn().mockResolvedValue(undefined)
      service.setDeliveryFunction(mockDeliverFn)

      await service.create(reminder)

      // mock.calls[0] is the isSafeCronFrequency validation call;
      // mock.calls[1] is the actual scheduling call with the delivery callback
      const cronJobCall = (CronJob as unknown as jest.Mock).mock.calls[1] as [
        string,
        () => void,
      ]
      const cronCallback = cronJobCall[1]
      void cronCallback()

      // Allow async microtasks to settle
      await new Promise(resolve => setImmediate(resolve))

      expect(mockDeliverFn).toHaveBeenCalledWith(reminder)
    })
  })
})
