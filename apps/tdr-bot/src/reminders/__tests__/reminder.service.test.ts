import { createMockMetricsService } from 'src/__tests__/test-utils'
import { createTestReminder } from 'src/reminders/__tests__/factories/reminder'
import { MAX_REMINDERS_PER_USER } from 'src/reminders/reminder.constants'
import { ReminderRepository } from 'src/reminders/reminder.repository'
import {
  CreateReminderInput,
  ReminderError,
  ReminderErrorCode,
  ReminderService,
} from 'src/reminders/reminder.service'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'

const NOW = new Date('2026-06-01T12:00:00Z')
const FUTURE = new Date('2026-06-02T12:00:00Z')

function makeRepo() {
  return {
    insert: jest.fn(async row => createTestReminder({ ...row })),
    findById: jest.fn(),
    update: jest.fn(async (id, patch) => createTestReminder({ id, ...patch })),
    list: jest.fn().mockResolvedValue([]),
    listActiveForUser: jest.fn().mockResolvedValue([]),
    countActiveCreatedBy: jest.fn().mockResolvedValue(0),
  }
}

const baseInput = (
  overrides: Partial<CreateReminderInput> = {},
): CreateReminderInput => ({
  userId: 'user-1',
  userName: 'tester',
  guildId: 'guild-1',
  what: 'pay rent',
  schedule: { kind: 'once', at: FUTURE },
  ...overrides,
})

async function codeOf(promise: Promise<unknown> | (() => unknown) | unknown) {
  try {
    if (typeof promise === 'function') await promise()
    else await promise
  } catch (err) {
    return err instanceof ReminderError ? err.code : err
  }
  return undefined
}

describe('ReminderService', () => {
  let repo: ReturnType<typeof makeRepo>
  let metrics: jest.Mocked<TdrBotMetricsService>
  let service: ReminderService

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW })
    repo = makeRepo()
    metrics = createMockMetricsService()
    service = new ReminderService(
      repo as unknown as ReminderRepository,
      metrics,
    )
  })

  afterEach(() => jest.useRealTimers())

  describe('create', () => {
    it('inserts an active one-time row with nextRunAt and a described schedule', async () => {
      await service.create(baseInput({ what: '  pay rent  ' }))

      expect(repo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          what: 'pay rent',
          isRecurring: false,
          scheduledAt: FUTURE,
          cronExpression: null,
          nextRunAt: FUTURE,
          status: 'active',
          source: 'discord',
          actionType: 'default',
          scheduleDescription: expect.stringContaining('2026'),
        }),
      )
      expect(metrics.reminderCreated).toHaveBeenCalledWith('one_time')
    })

    it('uses the given scheduleDescription', async () => {
      await service.create(baseInput({ scheduleDescription: 'tomorrow noon' }))
      expect(repo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ scheduleDescription: 'tomorrow noon' }),
      )
    })

    it('computes the first cron run for recurring reminders', async () => {
      await service.create(
        baseInput({ schedule: { kind: 'recurring', cron: '0 9 * * *' } }),
      )
      const row = repo.insert.mock.calls[0][0]
      expect(row.isRecurring).toBe(true)
      expect(row.cronExpression).toBe('0 9 * * *')
      expect(row.nextRunAt).toBeInstanceOf(Date)
      expect(row.nextRunAt!.getTime()).toBeGreaterThan(NOW.getTime())
      expect(metrics.reminderCreated).toHaveBeenCalledWith('recurring')
    })

    it.each<[string, Partial<CreateReminderInput>, ReminderErrorCode]>([
      ['empty what', { what: '   ' }, 'invalid_what'],
      ['too-long what', { what: 'x'.repeat(501) }, 'invalid_what'],
      [
        'past one-time',
        { schedule: { kind: 'once', at: new Date('2026-05-01T00:00:00Z') } },
        'in_past',
      ],
      [
        'bad cron',
        { schedule: { kind: 'recurring', cron: 'not a cron' } },
        'invalid_cron',
      ],
      [
        'every-minute cron',
        { schedule: { kind: 'recurring', cron: '* * * * *' } },
        'cron_too_frequent',
      ],
      [
        'endsAt in the past',
        {
          schedule: {
            kind: 'recurring',
            cron: '0 9 * * *',
            endsAt: new Date('2026-05-01T00:00:00Z'),
          },
        },
        'ends_before_start',
      ],
      [
        'endsAt before first run',
        {
          schedule: {
            kind: 'recurring',
            cron: '0 0 1 * *',
            endsAt: new Date('2026-06-02T00:00:00Z'),
          },
        },
        'ends_before_start',
      ],
    ])('rejects %s', async (_name, overrides, code) => {
      expect(await codeOf(service.create(baseInput(overrides)))).toBe(code)
      expect(repo.insert).not.toHaveBeenCalled()
    })

    it('rejects discord reminders over the per-user cap', async () => {
      repo.countActiveCreatedBy.mockResolvedValue(MAX_REMINDERS_PER_USER)
      expect(await codeOf(service.create(baseInput()))).toBe('limit_reached')
    })

    it('does not apply the cap to admin reminders', async () => {
      repo.countActiveCreatedBy.mockResolvedValue(MAX_REMINDERS_PER_USER)
      await service.create(baseInput({ source: 'admin' }))
      expect(repo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'admin' }),
      )
      expect(repo.countActiveCreatedBy).not.toHaveBeenCalled()
    })
  })

  describe('update', () => {
    it('recomputes nextRunAt when the schedule changes', async () => {
      repo.findById.mockResolvedValue(createTestReminder({ id: 'r1' }))
      const later = new Date('2026-07-01T00:00:00Z')

      await service.update('r1', { schedule: { kind: 'once', at: later } })

      expect(repo.update).toHaveBeenCalledWith(
        'r1',
        expect.objectContaining({
          scheduledAt: later,
          nextRunAt: later,
          isRecurring: false,
        }),
      )
    })

    it('leaves nextRunAt alone for non-schedule patches', async () => {
      repo.findById.mockResolvedValue(createTestReminder({ id: 'r1' }))
      await service.update('r1', { what: ' new text ' })
      expect(repo.update).toHaveBeenCalledWith('r1', { what: 'new text' })
    })

    it('rejects non-active and unknown reminders', async () => {
      repo.findById.mockResolvedValueOnce(
        createTestReminder({ status: 'completed' }),
      )
      expect(await codeOf(service.update('r1', { what: 'x' }))).toBe(
        'not_active',
      )
      repo.findById.mockResolvedValueOnce(null)
      expect(await codeOf(service.update('r1', { what: 'x' }))).toBe(
        'not_found',
      )
    })

    it('validates the new schedule', async () => {
      repo.findById.mockResolvedValue(createTestReminder())
      expect(
        await codeOf(
          service.update('r1', {
            schedule: { kind: 'recurring', cron: '* * * * *' },
          }),
        ),
      ).toBe('cron_too_frequent')
    })
  })

  describe('cancel', () => {
    it('marks the reminder cancelled and clears nextRunAt', async () => {
      repo.findById.mockResolvedValue(createTestReminder({ id: 'r1' }))

      await service.cancel('r1', { userId: 'user-1' })

      expect(repo.update).toHaveBeenCalledWith('r1', {
        status: 'cancelled',
        cancelledAt: NOW,
        nextRunAt: null,
      })
      expect(metrics.reminderCancelled).toHaveBeenCalledWith('one_time')
    })

    it('lets the target user cancel', async () => {
      repo.findById.mockResolvedValue(
        createTestReminder({ targetUserId: 'user-2' }),
      )
      await service.cancel('reminder-1', { userId: 'user-2' })
      expect(repo.update).toHaveBeenCalled()
    })

    it('is forbidden for other users', async () => {
      repo.findById.mockResolvedValue(createTestReminder())
      expect(await codeOf(service.cancel('r1', { userId: 'intruder' }))).toBe(
        'forbidden',
      )
      expect(repo.update).not.toHaveBeenCalled()
    })

    it('allows an admin cancel without a user', async () => {
      repo.findById.mockResolvedValue(createTestReminder())
      await service.cancel('r1')
      expect(repo.update).toHaveBeenCalled()
    })

    it('reports not_found and not_active', async () => {
      repo.findById.mockResolvedValueOnce(null)
      expect(await codeOf(service.cancel('r1'))).toBe('not_found')
      repo.findById.mockResolvedValueOnce(
        createTestReminder({ status: 'cancelled' }),
      )
      expect(await codeOf(service.cancel('r1'))).toBe('not_active')
    })
  })

  describe('cancelAllForUser', () => {
    it('cancels every active reminder and returns the count', async () => {
      const rows = [
        createTestReminder({ id: 'a' }),
        createTestReminder({
          id: 'b',
          userId: 'other',
          targetUserId: 'user-1',
        }),
      ]
      repo.listActiveForUser.mockResolvedValue(rows)
      repo.findById.mockImplementation(
        async id => rows.find(r => r.id === id) ?? null,
      )

      expect(await service.cancelAllForUser('user-1')).toBe(2)
      expect(repo.update).toHaveBeenCalledTimes(2)
    })
  })

  describe('preview', () => {
    it('returns upcoming runs', () => {
      const runs = service.preview({ kind: 'recurring', cron: '0 9 * * *' }, 3)
      expect(runs).toHaveLength(3)
    })

    it('validates like create', async () => {
      expect(
        await codeOf(() =>
          service.preview({ kind: 'recurring', cron: '* * * * *' }),
        ),
      ).toBe('cron_too_frequent')
    })
  })

  describe('reads', () => {
    it('delegates get, listForUser and list to the repository', async () => {
      repo.findById.mockResolvedValue(null)
      await service.get('x')
      await service.listForUser('user-1')
      await service.list({ status: 'all' })
      expect(repo.findById).toHaveBeenCalledWith('x')
      expect(repo.listActiveForUser).toHaveBeenCalledWith('user-1')
      expect(repo.list).toHaveBeenCalledWith({ status: 'all' })
    })
  })
})
