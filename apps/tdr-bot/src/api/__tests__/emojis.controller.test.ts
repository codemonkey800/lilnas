import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { EmojisController } from 'src/api/emojis.controller'
import type { EmojiRow } from 'src/db/schema'
import { EmojiDictionaryRepository } from 'src/emojis/emoji-dictionary.repository'
import { EmojiDictionaryService } from 'src/emojis/emoji-dictionary.service'
import {
  EmojiDeletedError,
  EmojiNotFoundError,
  EmojiSyncService,
  ReconcileSummary,
} from 'src/emojis/emoji-sync.service'

function row(overrides: Partial<EmojiRow> = {}): EmojiRow {
  return {
    id: '111',
    guildId: 'g1',
    name: 'pog',
    animated: false,
    description: 'a shocked face',
    source: 'ai',
    model: 'gpt-test',
    describedAt: new Date('2026-10-10T00:00:00Z'),
    deletedAt: null,
    createdAt: new Date('2026-10-09T00:00:00Z'),
    updatedAt: new Date('2026-10-10T00:00:00Z'),
    ...overrides,
  }
}

const summary: ReconcileSummary = {
  trigger: 'boot',
  synced: 2,
  softDeleted: 0,
  seeded: 0,
  described: 1,
  failed: 0,
  durationMs: 10,
  finishedAt: '2026-10-10T00:00:00.000Z',
}

describe('EmojisController', () => {
  let app: INestApplication
  let base: string
  const repo = { listAll: jest.fn(), setDescription: jest.fn() }
  const dictionary = { refresh: jest.fn() }
  const sync = {
    status: jest.fn(),
    reconcile: jest.fn(),
    redescribe: jest.fn(),
    redescribeAll: jest.fn(),
  }

  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  beforeEach(async () => {
    jest.resetAllMocks()
    sync.status.mockReturnValue({ running: false, last: null })
    const module = await Test.createTestingModule({
      controllers: [EmojisController],
      providers: [
        { provide: EmojiDictionaryRepository, useValue: repo },
        { provide: EmojiDictionaryService, useValue: dictionary },
        { provide: EmojiSyncService, useValue: sync },
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

  describe('GET /emojis', () => {
    it('lists live rows first, then deleted, each by name ignoring case', async () => {
      repo.listAll.mockResolvedValue([
        row({ id: '1', name: 'zebra' }),
        row({ id: '2', name: 'Apple', deletedAt: new Date() }),
        row({ id: '3', name: 'banana' }),
        row({ id: '4', name: 'Alpha' }),
        row({ id: '5', name: 'aardvark', deletedAt: new Date() }),
      ])
      sync.status.mockReturnValue({ running: true, last: summary })

      const res = await send('GET', '/emojis')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.emojis.map((e: { name: string }) => e.name)).toEqual([
        'Alpha',
        'banana',
        'zebra',
        'aardvark',
        'Apple',
      ])
      expect(body.reconcile).toEqual({ running: true, last: summary })
    })

    it('maps rows to views', async () => {
      repo.listAll.mockResolvedValue([
        row({ id: '1', name: 'still' }),
        row({
          id: '2',
          name: 'dance',
          animated: true,
          description: null,
          source: null,
          model: null,
          describedAt: null,
          deletedAt: new Date('2026-10-11T00:00:00Z'),
        }),
      ])

      const body = await (await send('GET', '/emojis')).json()

      expect(body.emojis).toEqual([
        {
          id: '1',
          guildId: 'g1',
          name: 'still',
          animated: false,
          key: '<:still:1>',
          imageUrl: 'https://cdn.discordapp.com/emojis/1.png',
          description: 'a shocked face',
          source: 'ai',
          model: 'gpt-test',
          describedAt: '2026-10-10T00:00:00.000Z',
          deletedAt: null,
          updatedAt: '2026-10-10T00:00:00.000Z',
        },
        {
          id: '2',
          guildId: 'g1',
          name: 'dance',
          animated: true,
          key: '<a:dance:2>',
          imageUrl: 'https://cdn.discordapp.com/emojis/2.gif',
          description: null,
          source: null,
          model: null,
          describedAt: null,
          deletedAt: '2026-10-11T00:00:00.000Z',
          updatedAt: '2026-10-10T00:00:00.000Z',
        },
      ])
    })
  })

  describe('PATCH /emojis/:id', () => {
    it('saves a trimmed manual description and refreshes the dictionary', async () => {
      repo.setDescription.mockResolvedValue(
        row({ description: 'hype', source: 'manual', model: null }),
      )

      const res = await send('PATCH', '/emojis/111', {
        description: '  hype  ',
      })

      expect(res.status).toBe(200)
      expect(repo.setDescription).toHaveBeenCalledWith('111', {
        description: 'hype',
        source: 'manual',
        model: null,
      })
      expect(dictionary.refresh).toHaveBeenCalledTimes(1)
      expect(await res.json()).toMatchObject({
        id: '111',
        description: 'hype',
        source: 'manual',
        model: null,
      })
    })

    it.each([
      ['blank', { description: '   ' }],
      ['too long', { description: 'x'.repeat(301) }],
      ['missing', {}],
    ])('rejects a %s description', async (_, body) => {
      const res = await send('PATCH', '/emojis/111', body)

      expect(res.status).toBe(400)
      expect(repo.setDescription).not.toHaveBeenCalled()
      expect(dictionary.refresh).not.toHaveBeenCalled()
    })

    it('accepts exactly 300 characters', async () => {
      repo.setDescription.mockResolvedValue(row())

      const res = await send('PATCH', '/emojis/111', {
        description: 'x'.repeat(300),
      })

      expect(res.status).toBe(200)
    })

    it('404s for an unknown id', async () => {
      repo.setDescription.mockResolvedValue(undefined)

      const res = await send('PATCH', '/emojis/999', { description: 'hype' })

      expect(res.status).toBe(404)
      expect(dictionary.refresh).not.toHaveBeenCalled()
    })
  })

  describe('POST /emojis/:id/redescribe', () => {
    it('returns the re-described view', async () => {
      sync.redescribe.mockResolvedValue(row({ description: 'new words' }))

      const res = await send('POST', '/emojis/111/redescribe')

      expect(res.status).toBe(200)
      expect(sync.redescribe).toHaveBeenCalledWith('111')
      expect(await res.json()).toMatchObject({
        id: '111',
        description: 'new words',
      })
    })

    it.each([
      ['EmojiNotFoundError', new EmojiNotFoundError('111'), 404],
      ['EmojiDeletedError', new EmojiDeletedError('111'), 409],
      ['any other error', new Error('model exploded'), 502],
    ])('maps %s to %i', async (_, err, status) => {
      sync.redescribe.mockRejectedValue(err)

      const res = await send('POST', '/emojis/111/redescribe')

      expect(res.status).toBe(status)
      expect((await res.json()).message).toBe(err.message)
    })
  })

  describe('POST /emojis/reconcile', () => {
    it('starts an admin reconcile when idle', async () => {
      sync.reconcile.mockResolvedValue(summary)

      const res = await send('POST', '/emojis/reconcile')

      expect(res.status).toBe(202)
      expect(await res.json()).toEqual({ started: true })
      expect(sync.reconcile).toHaveBeenCalledWith('admin')
    })

    it('still answers when the background run rejects', async () => {
      sync.reconcile.mockRejectedValue(new Error('boom'))

      const res = await send('POST', '/emojis/reconcile')

      expect(res.status).toBe(202)
      expect(await res.json()).toEqual({ started: true })
    })

    it('does not start another run while one is running', async () => {
      sync.status.mockReturnValue({ running: true, last: null })

      const res = await send('POST', '/emojis/reconcile')

      expect(res.status).toBe(202)
      expect(await res.json()).toEqual({ started: false })
      expect(sync.reconcile).not.toHaveBeenCalled()
    })
  })

  describe('POST /emojis/redescribe-all', () => {
    it('starts a run when idle', async () => {
      sync.redescribeAll.mockResolvedValue({
        ...summary,
        trigger: 'redescribe-all',
      })

      const res = await send('POST', '/emojis/redescribe-all')

      expect(res.status).toBe(202)
      expect(await res.json()).toEqual({ started: true })
      expect(sync.redescribeAll).toHaveBeenCalledTimes(1)
    })

    it('still answers when the background run rejects', async () => {
      sync.redescribeAll.mockRejectedValue(new Error('boom'))

      const res = await send('POST', '/emojis/redescribe-all')

      expect(res.status).toBe(202)
      expect(await res.json()).toEqual({ started: true })
    })

    it('does not start another run while one is running', async () => {
      sync.status.mockReturnValue({ running: true, last: null })

      const res = await send('POST', '/emojis/redescribe-all')

      expect(await res.json()).toEqual({ started: false })
      expect(sync.redescribeAll).not.toHaveBeenCalled()
    })
  })
})
