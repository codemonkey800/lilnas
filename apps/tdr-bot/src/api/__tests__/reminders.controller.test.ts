import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Client } from 'discord.js'

import { RemindersController } from 'src/api/reminders.controller'
import type { Reminder } from 'src/db/schema'
import {
  ReminderError,
  ReminderErrorCode,
  ReminderService,
} from 'src/reminders/reminder.service'

function row(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r1',
    userId: 'u1',
    userName: 'stored',
    guildId: 'g1',
    what: 'stretch',
    isRecurring: false,
    cronExpression: null,
    scheduledAt: new Date('2026-10-08T12:00:00Z'),
    endsAt: null,
    scheduleDescription: 'Oct 8',
    channelId: null,
    targetUserId: null,
    actionType: 'default',
    status: 'active',
    source: 'admin',
    nextRunAt: new Date('2026-10-08T12:00:00Z'),
    lastRunAt: null,
    runCount: 0,
    createdAt: new Date('2026-10-07T00:00:00Z'),
    updatedAt: new Date('2026-10-07T00:00:00Z'),
    cancelledAt: null,
    ...overrides,
  }
}

function member(id: string, displayName: string, bot = false) {
  return {
    id,
    displayName,
    user: {
      username: `${displayName.toLowerCase()}-user`,
      bot,
      displayAvatarURL: () => `https://cdn/${id}.png`,
    },
  }
}

describe('RemindersController', () => {
  let app: INestApplication
  let base: string
  const service = {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    cancel: jest.fn(),
    preview: jest.fn(),
  }
  const users = new Map<string, unknown>()
  const channels = new Map<string, unknown>()
  const memberCache = new Map<string, unknown>()
  const fetchMembers = jest.fn()
  const guilds = new Map<string, unknown>()

  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  beforeEach(async () => {
    jest.resetAllMocks()
    users.clear()
    channels.clear()
    memberCache.clear()
    guilds.clear()
    guilds.set('g1', {
      id: 'g1',
      members: { fetch: fetchMembers, cache: memberCache },
    })
    const module = await Test.createTestingModule({
      controllers: [RemindersController],
      providers: [
        { provide: ReminderService, useValue: service },
        {
          provide: Client,
          useValue: {
            users: { cache: users },
            channels: { cache: channels },
            guilds: {
              cache: {
                first: () => guilds.values().next().value,
              },
            },
          },
        },
      ],
    }).compile()
    app = module.createNestApplication({ logger: false })
    await app.init()
    await app.listen(0, '127.0.0.1')
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1')
  })

  afterEach(async () => {
    await app.close()
  })

  describe('GET /reminders', () => {
    it('defaults to active reminders', async () => {
      service.list.mockResolvedValue([row()])

      const res = await fetch(`${base}/reminders`)

      expect(res.status).toBe(200)
      expect(service.list).toHaveBeenCalledWith({
        status: 'active',
        userId: undefined,
      })
      expect(await res.json()).toHaveLength(1)
    })

    it('passes status=all and userId through', async () => {
      service.list.mockResolvedValue([])

      await fetch(`${base}/reminders?status=all&userId=u9`)

      expect(service.list).toHaveBeenCalledWith({
        status: 'all',
        userId: 'u9',
      })
    })

    it('rejects an unknown status', async () => {
      const res = await fetch(`${base}/reminders?status=bogus`)

      expect(res.status).toBe(400)
      expect(service.list).not.toHaveBeenCalled()
    })

    it('resolves names from members, users and channels with fallbacks', async () => {
      memberCache.set('u1', { displayName: 'Mika' })
      users.set('u2', { displayName: 'Raze', username: 'raze' })
      channels.set('c1', { name: 'general' })
      service.list.mockResolvedValue([
        row({ targetUserId: 'u2', channelId: 'c1' }),
        row({ id: 'r2', userId: 'u3', targetUserId: 'u4', channelId: 'c2' }),
      ])

      const json = await (await fetch(`${base}/reminders`)).json()

      expect(json[0]).toMatchObject({
        userName: 'Mika',
        targetUserName: 'Raze',
        channelName: 'general',
        scheduledAt: '2026-10-08T12:00:00.000Z',
      })
      expect(json[1]).toMatchObject({
        userName: 'stored',
        targetUserName: 'u4',
        channelName: 'c2',
      })
    })
  })

  describe('GET /reminders/members', () => {
    it('excludes bots and sorts by display name', async () => {
      fetchMembers.mockResolvedValue(
        new Map([
          ['2', member('2', 'Zed')],
          ['3', member('3', 'Robo', true)],
          ['1', member('1', 'Ana')],
        ]),
      )

      const res = await fetch(`${base}/reminders/members`)

      expect(await res.json()).toEqual([
        {
          id: '1',
          username: 'ana-user',
          displayName: 'Ana',
          avatarUrl: 'https://cdn/1.png',
        },
        {
          id: '2',
          username: 'zed-user',
          displayName: 'Zed',
          avatarUrl: 'https://cdn/2.png',
        },
      ])
    })

    it('returns 503 when the client has no guild', async () => {
      guilds.clear()

      const res = await fetch(`${base}/reminders/members`)

      expect(res.status).toBe(503)
    })
  })

  describe('POST /reminders/preview', () => {
    it('returns ISO runs and a description', async () => {
      service.preview.mockReturnValue([
        new Date('2026-10-08T00:00:00Z'),
        new Date('2026-10-09T00:00:00Z'),
      ])

      const res = await send('POST', '/reminders/preview', {
        schedule: { kind: 'recurring', cron: '0 0 * * *' },
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        runs: ['2026-10-08T00:00:00.000Z', '2026-10-09T00:00:00.000Z'],
        description: 'cron 0 0 * * *',
      })
      expect(service.preview).toHaveBeenCalledWith({
        kind: 'recurring',
        cron: '0 0 * * *',
        endsAt: null,
      })
    })

    it('maps a ReminderError to 400 with its code', async () => {
      service.preview.mockImplementation(() => {
        throw new ReminderError('invalid_cron', 'Invalid cron expression')
      })

      const res = await send('POST', '/reminders/preview', {
        schedule: { kind: 'recurring', cron: 'nope' },
      })

      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({
        message: 'Invalid cron expression',
        code: 'invalid_cron',
      })
    })
  })

  describe('POST /reminders', () => {
    it('creates an admin reminder in the first guild', async () => {
      service.create.mockResolvedValue(row())

      const res = await send('POST', '/reminders', {
        userId: 'u1',
        what: '  stretch  ',
        schedule: { kind: 'once', at: '2026-10-08T12:00:00Z' },
        channelId: 'c1',
        actionType: 'search',
      })

      expect(res.status).toBe(201)
      expect((await res.json()).id).toBe('r1')
      expect(service.create).toHaveBeenCalledWith({
        userId: 'u1',
        userName: 'admin',
        guildId: 'g1',
        what: 'stretch',
        schedule: { kind: 'once', at: new Date('2026-10-08T12:00:00Z') },
        scheduleDescription: undefined,
        channelId: 'c1',
        targetUserId: undefined,
        actionType: 'search',
        source: 'admin',
      })
    })

    it('rejects an invalid body with issues', async () => {
      const res = await send('POST', '/reminders', {
        userId: 'u1',
        what: '',
        schedule: { kind: 'once', at: 'tomorrow' },
        extra: true,
      })
      const json = await res.json()

      expect(res.status).toBe(400)
      expect(json.issues.length).toBeGreaterThan(0)
      expect(service.create).not.toHaveBeenCalled()
    })

    it('returns 503 with no guild', async () => {
      guilds.clear()

      const res = await send('POST', '/reminders', {
        userId: 'u1',
        what: 'x',
        schedule: { kind: 'once', at: '2026-10-08T12:00:00Z' },
      })

      expect(res.status).toBe(503)
      expect(service.create).not.toHaveBeenCalled()
    })
  })

  describe('PATCH /reminders/:id', () => {
    it('converts a schedule patch and returns the view', async () => {
      service.update.mockResolvedValue(row({ what: 'new' }))

      const res = await send('PATCH', '/reminders/r1', {
        what: 'new',
        schedule: {
          kind: 'recurring',
          cron: '0 0 * * *',
          endsAt: '2026-12-01T00:00:00Z',
        },
      })

      expect(res.status).toBe(200)
      expect((await res.json()).what).toBe('new')
      expect(service.update).toHaveBeenCalledWith('r1', {
        what: 'new',
        schedule: {
          kind: 'recurring',
          cron: '0 0 * * *',
          endsAt: new Date('2026-12-01T00:00:00Z'),
        },
      })
    })

    it('rejects unknown keys such as userId', async () => {
      const res = await send('PATCH', '/reminders/r1', { userId: 'u2' })

      expect(res.status).toBe(400)
      expect(service.update).not.toHaveBeenCalled()
    })
  })

  describe('DELETE /reminders/:id', () => {
    it('returns the cancelled reminder', async () => {
      service.cancel.mockResolvedValue(
        row({
          status: 'cancelled',
          cancelledAt: new Date('2026-10-07T02:00:00Z'),
        }),
      )

      const res = await send('DELETE', '/reminders/r1')

      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({
        status: 'cancelled',
        cancelledAt: '2026-10-07T02:00:00.000Z',
      })
      expect(service.cancel).toHaveBeenCalledWith('r1')
    })
  })

  describe('ReminderError mapping', () => {
    it.each<[ReminderErrorCode, number]>([
      ['not_found', 404],
      ['forbidden', 403],
      ['not_active', 409],
      ['in_past', 400],
      ['limit_reached', 400],
      ['invalid_what', 400],
    ])('maps %s to %i', async (code, status) => {
      service.cancel.mockRejectedValue(new ReminderError(code, 'boom'))

      const res = await send('DELETE', '/reminders/r1')

      expect(res.status).toBe(status)
      expect(await res.json()).toMatchObject({ message: 'boom', code })
    })
  })
})
