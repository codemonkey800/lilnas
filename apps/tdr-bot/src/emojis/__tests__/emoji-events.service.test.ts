import { Logger } from '@nestjs/common'
import type { GuildEmoji } from 'discord.js'

import { EmojiEventsService } from 'src/emojis/emoji-events.service'
import {
  EmojiSyncService,
  ReconcileSummary,
  ReconcileTrigger,
} from 'src/emojis/emoji-sync.service'

function makeSummary(trigger: ReconcileTrigger): ReconcileSummary {
  return {
    trigger,
    synced: 0,
    softDeleted: 0,
    described: 0,
    failed: 0,
    durationMs: 0,
    finishedAt: new Date(0).toISOString(),
  }
}

function makeEmoji(id: string): GuildEmoji {
  return { id, name: `emoji_${id}` } as unknown as GuildEmoji
}

function setup() {
  const reconcile = jest.fn<Promise<ReconcileSummary>, [ReconcileTrigger]>()
  const syncEmoji = jest.fn<Promise<void>, [GuildEmoji]>()
  const removeEmoji = jest.fn<Promise<void>, [string]>()
  const sync = {
    reconcile,
    syncEmoji,
    removeEmoji,
  } as unknown as EmojiSyncService
  const logError = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined)
  const service = new EmojiEventsService(sync)
  return { service, reconcile, syncEmoji, removeEmoji, logError }
}

/** Lets pending promise callbacks run. */
const flush = () => new Promise<void>(resolve => setImmediate(resolve))

describe('EmojiEventsService', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('onClientReady', () => {
    it('starts a boot reconcile and returns before it resolves', async () => {
      const { service, reconcile } = setup()
      let resolve: (summary: ReconcileSummary) => void = () => undefined
      reconcile.mockReturnValue(
        new Promise(r => {
          resolve = r
        }),
      )

      const result = service.onClientReady()

      expect(result).toBeUndefined()
      expect(reconcile).toHaveBeenCalledWith('boot')
      resolve(makeSummary('boot'))
      await flush()
    })

    it('logs a rejected boot reconcile', async () => {
      const { service, reconcile, logError } = setup()
      reconcile.mockRejectedValue(new Error('db down'))

      expect(() => service.onClientReady()).not.toThrow()
      await flush()

      expect(logError).toHaveBeenCalledWith(
        { trigger: 'boot', error: 'db down' },
        'emoji.reconcile.failed',
      )
    })
  })

  describe('gateway events', () => {
    it('syncs a created emoji', async () => {
      const { service, syncEmoji } = setup()
      syncEmoji.mockResolvedValue(undefined)
      const emoji = makeEmoji('1')

      await service.onEmojiCreate([emoji])

      expect(syncEmoji).toHaveBeenCalledWith(emoji)
    })

    it('syncs the new emoji on update', async () => {
      const { service, syncEmoji } = setup()
      syncEmoji.mockResolvedValue(undefined)
      const oldEmoji = makeEmoji('1')
      const newEmoji = makeEmoji('1')

      await service.onEmojiUpdate([oldEmoji, newEmoji])

      expect(syncEmoji).toHaveBeenCalledTimes(1)
      expect(syncEmoji.mock.calls[0][0]).toBe(newEmoji)
    })

    it('removes a deleted emoji by id', async () => {
      const { service, removeEmoji } = setup()
      removeEmoji.mockResolvedValue(undefined)

      await service.onEmojiDelete([makeEmoji('7')])

      expect(removeEmoji).toHaveBeenCalledWith('7')
    })

    it('swallows and logs a sync failure on create', async () => {
      const { service, syncEmoji, logError } = setup()
      syncEmoji.mockRejectedValue(new Error('boom'))

      await expect(
        service.onEmojiCreate([makeEmoji('1')]),
      ).resolves.toBeUndefined()

      expect(logError).toHaveBeenCalledWith(
        { emojiId: '1', error: 'boom' },
        'emoji.sync.failed',
      )
    })

    it('swallows and logs a sync failure on update', async () => {
      const { service, syncEmoji, logError } = setup()
      syncEmoji.mockRejectedValue(new Error('boom'))

      await expect(
        service.onEmojiUpdate([makeEmoji('2'), makeEmoji('2')]),
      ).resolves.toBeUndefined()

      expect(logError).toHaveBeenCalledWith(
        { emojiId: '2', error: 'boom' },
        'emoji.sync.failed',
      )
    })

    it('swallows and logs a remove failure', async () => {
      const { service, removeEmoji, logError } = setup()
      removeEmoji.mockRejectedValue(new Error('boom'))

      await expect(
        service.onEmojiDelete([makeEmoji('3')]),
      ).resolves.toBeUndefined()

      expect(logError).toHaveBeenCalledWith(
        { emojiId: '3', error: 'boom' },
        'emoji.remove.failed',
      )
    })
  })

  describe('onNightly', () => {
    it('runs a cron reconcile', async () => {
      const { service, reconcile } = setup()
      reconcile.mockResolvedValue(makeSummary('cron'))

      await service.onNightly()

      expect(reconcile).toHaveBeenCalledWith('cron')
    })

    it('swallows and logs a cron reconcile failure', async () => {
      const { service, reconcile, logError } = setup()
      reconcile.mockRejectedValue(new Error('timeout'))

      await expect(service.onNightly()).resolves.toBeUndefined()

      expect(logError).toHaveBeenCalledWith(
        { trigger: 'cron', error: 'timeout' },
        'emoji.reconcile.failed',
      )
    })
  })
})
