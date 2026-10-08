import { Client } from 'discord.js'

import { createMockMetricsService } from 'src/__tests__/test-utils'
import { createTestReminder } from 'src/reminders/__tests__/factories/reminder'
import {
  FINISHED_RETENTION_DAYS,
  MAX_LATE_DELIVERY_MS,
} from 'src/reminders/reminder.constants'
import { ReminderRepository } from 'src/reminders/reminder.repository'
import { ReminderDeliveryService } from 'src/reminders/reminder-delivery.service'
import { ReminderSchedulerService } from 'src/reminders/reminder-scheduler.service'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'

const NOW = new Date('2026-06-01T12:00:00Z')

describe('ReminderSchedulerService', () => {
  let repo: {
    listDue: jest.Mock
    listActiveWithoutNextRun: jest.Mock
    update: jest.Mock
    advanceIfActive: jest.Mock
    countActiveByType: jest.Mock
    deleteFinishedBefore: jest.Mock
  }
  let delivery: { deliver: jest.Mock }
  let metrics: jest.Mocked<TdrBotMetricsService>
  let client: { isReady: jest.Mock }
  let service: ReminderSchedulerService

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW })
    repo = {
      listDue: jest.fn().mockResolvedValue([]),
      listActiveWithoutNextRun: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(null),
      advanceIfActive: jest.fn().mockResolvedValue(createTestReminder()),
      countActiveByType: jest
        .fn()
        .mockResolvedValue({ recurring: 1, oneTime: 2 }),
      deleteFinishedBefore: jest.fn().mockResolvedValue(0),
    }
    delivery = { deliver: jest.fn().mockResolvedValue({ ok: true }) }
    metrics = createMockMetricsService()
    client = { isReady: jest.fn().mockReturnValue(true) }
    service = new ReminderSchedulerService(
      repo as unknown as ReminderRepository,
      delivery as unknown as ReminderDeliveryService,
      metrics,
      client as unknown as Client,
    )
  })

  afterEach(() => jest.useRealTimers())

  describe('reconcile', () => {
    it('sets nextRunAt to a future one-time scheduledAt', async () => {
      const at = new Date(NOW.getTime() + 60_000)
      repo.listActiveWithoutNextRun.mockResolvedValue([
        createTestReminder({ scheduledAt: at, nextRunAt: null }),
      ])
      await service.reconcile()
      expect(repo.update).toHaveBeenCalledWith('reminder-1', { nextRunAt: at })
    })

    it('marks a one-time reminder missed when too late', async () => {
      repo.listActiveWithoutNextRun.mockResolvedValue([
        createTestReminder({
          scheduledAt: new Date(NOW.getTime() - MAX_LATE_DELIVERY_MS - 1),
          nextRunAt: null,
        }),
      ])
      await service.reconcile()
      expect(repo.update).toHaveBeenCalledWith('reminder-1', {
        status: 'missed',
        nextRunAt: null,
      })
      expect(metrics.reminderFailed).toHaveBeenCalledWith('missed')
    })

    it('delivers a slightly late one-time reminder on the first tick', async () => {
      repo.listActiveWithoutNextRun.mockResolvedValue([
        createTestReminder({
          scheduledAt: new Date(NOW.getTime() - 60_000),
          nextRunAt: null,
        }),
      ])
      await service.reconcile()
      expect(repo.update).toHaveBeenCalledWith('reminder-1', { nextRunAt: NOW })
    })

    it('computes the next cron run for recurring rows', async () => {
      repo.listActiveWithoutNextRun.mockResolvedValue([
        createTestReminder({
          isRecurring: true,
          cronExpression: '0 9 * * *',
          scheduledAt: null,
          nextRunAt: null,
        }),
      ])
      await service.reconcile()
      const patch = repo.update.mock.calls[0][1]
      expect(patch.nextRunAt.getTime()).toBeGreaterThan(NOW.getTime())
    })

    it('completes a recurring row whose endsAt has passed', async () => {
      repo.listActiveWithoutNextRun.mockResolvedValue([
        createTestReminder({
          isRecurring: true,
          cronExpression: '0 9 * * *',
          scheduledAt: null,
          nextRunAt: null,
          endsAt: new Date(NOW.getTime() - 1000),
        }),
      ])
      await service.reconcile()
      expect(repo.update).toHaveBeenCalledWith('reminder-1', {
        status: 'completed',
        nextRunAt: null,
      })
    })
  })

  describe('onModuleInit', () => {
    it('reconciles then refreshes the gauge', async () => {
      await service.onModuleInit()
      expect(repo.listActiveWithoutNextRun).toHaveBeenCalled()
      expect(metrics.setActiveReminders).toHaveBeenCalledWith({
        recurring: 1,
        oneTime: 2,
      })
    })
  })

  describe('tick', () => {
    const due = (overrides = {}) =>
      createTestReminder({
        nextRunAt: new Date(NOW.getTime() - 1000),
        ...overrides,
      })

    it('delivers due rows in order and completes one-time reminders', async () => {
      repo.listDue.mockResolvedValue([due({ id: 'a' }), due({ id: 'b' })])

      await service.tick()

      expect(delivery.deliver.mock.calls.map(c => c[0].id)).toEqual(['a', 'b'])
      expect(repo.advanceIfActive).toHaveBeenCalledWith(
        'a',
        new Date(NOW.getTime() - 1000),
        {
          status: 'completed',
          nextRunAt: null,
          lastRunAt: NOW,
          runCount: 1,
        },
      )
      expect(metrics.reminderDelivered).toHaveBeenCalledTimes(2)
      expect(metrics.setActiveReminders).toHaveBeenCalled()
    })

    it('advances recurring reminders to the next cron run', async () => {
      repo.listDue.mockResolvedValue([
        due({
          isRecurring: true,
          cronExpression: '0 9 * * *',
          scheduledAt: null,
          runCount: 4,
        }),
      ])
      await service.tick()
      const patch = repo.advanceIfActive.mock.calls[0][2]
      expect(patch.status).toBe('active')
      expect(patch.nextRunAt.getTime()).toBeGreaterThan(NOW.getTime())
      expect(patch.runCount).toBe(5)
      expect(patch.lastRunAt).toEqual(NOW)
    })

    it('completes a recurring reminder at endsAt', async () => {
      repo.listDue.mockResolvedValue([
        due({
          isRecurring: true,
          cronExpression: '0 9 * * *',
          scheduledAt: null,
          endsAt: new Date(NOW.getTime() + 60_000),
        }),
      ])
      await service.tick()
      expect(repo.advanceIfActive).toHaveBeenCalledWith(
        'reminder-1',
        new Date(NOW.getTime() - 1000),
        expect.objectContaining({ status: 'completed', nextRunAt: null }),
      )
    })

    it('still advances when delivery fails', async () => {
      delivery.deliver.mockResolvedValue({ ok: false, reason: 'send_error' })
      repo.listDue.mockResolvedValue([due()])

      await service.tick()

      expect(metrics.reminderFailed).toHaveBeenCalledWith('send_error')
      expect(metrics.reminderDelivered).not.toHaveBeenCalled()
      expect(repo.advanceIfActive).toHaveBeenCalledWith(
        'reminder-1',
        new Date(NOW.getTime() - 1000),
        expect.objectContaining({ status: 'completed' }),
      )
    })

    it('does not resurrect a reminder cancelled after listDue', async () => {
      repo.listDue.mockResolvedValue([
        due({
          isRecurring: true,
          cronExpression: '0 9 * * *',
          scheduledAt: null,
        }),
      ])
      // The guarded update matches no row because it was cancelled meanwhile.
      repo.advanceIfActive.mockResolvedValue(null)

      await service.tick()

      expect(repo.advanceIfActive).toHaveBeenCalledTimes(1)
      expect(repo.update).not.toHaveBeenCalled()
    })

    it('skips an overlapping tick', async () => {
      let release: () => void = () => {}
      delivery.deliver.mockReturnValue(
        new Promise(resolve => {
          release = () => resolve({ ok: true })
        }),
      )
      repo.listDue.mockResolvedValue([due()])

      const first = service.tick()
      await service.tick()
      expect(repo.listDue).toHaveBeenCalledTimes(1)

      release()
      await first
    })

    it('skips when the client is not ready', async () => {
      client.isReady.mockReturnValue(false)
      await service.tick()
      expect(repo.listDue).not.toHaveBeenCalled()
    })

    it('runs again after a previous tick finished', async () => {
      await service.tick()
      await service.tick()
      expect(repo.listDue).toHaveBeenCalledTimes(2)
    })
  })

  describe('prune', () => {
    it('deletes finished rows older than the retention window', async () => {
      await service.prune()
      expect(repo.deleteFinishedBefore).toHaveBeenCalledWith(
        new Date(NOW.getTime() - FINISHED_RETENTION_DAYS * 86_400_000),
      )
    })
  })
})
