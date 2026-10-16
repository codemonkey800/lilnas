import type { Client, GuildEmoji } from 'discord.js'

import { EmojiRow } from 'src/db/schema'
import {
  DescribeInput,
  DescribeResult,
  EmojiDescriberService,
  EmojiExample,
} from 'src/emojis/emoji-describer.service'
import {
  EmojiDescription,
  EmojiDictionaryRepository,
  EmojiMeta,
} from 'src/emojis/emoji-dictionary.repository'
import { EmojiDictionaryService } from 'src/emojis/emoji-dictionary.service'
import {
  EmojiDeletedError,
  EmojiNotFoundError,
  EmojiSyncService,
} from 'src/emojis/emoji-sync.service'

/** HYPERS, present in src/utils/emojis.ts. */
const SEED_ID = '564310072822333480'
const SEED_DESCRIPTION = 'Use this when excited about something'

/** In-memory stand-in for the Drizzle repository. */
class FakeRepo {
  readonly rows = new Map<string, EmojiRow>()
  readonly upserts: EmojiMeta[][] = []

  async upsertMeta(metas: EmojiMeta[]): Promise<void> {
    this.upserts.push(metas)
    for (const meta of metas) {
      const existing = this.rows.get(meta.id)
      this.rows.set(meta.id, {
        description: null,
        source: null,
        model: null,
        describedAt: null,
        createdAt: new Date(),
        ...existing,
        ...meta,
        deletedAt: null,
        updatedAt: new Date(),
      })
    }
  }

  async softDeleteMissing(
    keepIds: string[],
    skipGuildIds: string[],
  ): Promise<number> {
    let count = 0
    for (const row of this.rows.values()) {
      if (row.deletedAt || keepIds.includes(row.id)) continue
      if (skipGuildIds.includes(row.guildId)) continue
      row.deletedAt = new Date()
      count++
    }
    return count
  }

  async softDelete(id: string): Promise<void> {
    const row = this.rows.get(id)
    if (row && !row.deletedAt) row.deletedAt = new Date()
  }

  async listUndescribed(): Promise<EmojiRow[]> {
    return [...this.rows.values()].filter(
      row => row.description === null && !row.deletedAt,
    )
  }

  async listManualExamples(limit: number): Promise<EmojiRow[]> {
    return [...this.rows.values()]
      .filter(
        row =>
          row.source === 'manual' && row.description !== null && !row.deletedAt,
      )
      .slice(0, limit)
  }

  async listAll(): Promise<EmojiRow[]> {
    return [...this.rows.values()]
  }

  async get(id: string): Promise<EmojiRow | undefined> {
    return this.rows.get(id)
  }

  async fillDescription(id: string, value: EmojiDescription): Promise<boolean> {
    const row = this.rows.get(id)
    if (!row || row.description !== null) return false
    Object.assign(row, value, { describedAt: new Date() })
    return true
  }

  async setDescription(
    id: string,
    value: EmojiDescription,
  ): Promise<EmojiRow | undefined> {
    const row = this.rows.get(id)
    if (!row) return undefined
    Object.assign(row, value, { describedAt: new Date() })
    return row
  }

  seed(overrides: Partial<EmojiRow> & Pick<EmojiRow, 'id'>): EmojiRow {
    const row: EmojiRow = {
      guildId: 'g1',
      name: `emoji${overrides.id}`,
      animated: false,
      description: null,
      source: null,
      model: null,
      describedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }
    this.rows.set(row.id, row)
    return row
  }
}

interface FakeEmoji {
  id: string
  name: string | null
  animated: boolean
}

interface FakeGuild {
  id: string
  available: boolean
  emojis: { cache: Map<string, FakeEmoji> }
}

function guild(id: string, emojis: FakeEmoji[], available = true): FakeGuild {
  return {
    id,
    available,
    emojis: { cache: new Map(emojis.map(emoji => [emoji.id, emoji])) },
  }
}

function emoji(id: string, name: string | null = `emoji${id}`): FakeEmoji {
  return { id, name, animated: false }
}

/** A promise with its resolver exposed, for holding work in flight. */
function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

function setup(guilds: FakeGuild[] = [], ready = true) {
  const repo = new FakeRepo()
  const dictionary = { refresh: jest.fn().mockResolvedValue(undefined) }
  const describeEmoji = jest.fn<
    Promise<DescribeResult>,
    [DescribeInput, EmojiExample[]]
  >(async input => ({
    description: `AI says ${input.name}`,
    model: 'gpt-6-luna',
  }))
  const describeBatch = jest.fn<
    Promise<Map<string, DescribeResult>>,
    [DescribeInput[], EmojiExample[]]
  >(
    async inputs =>
      new Map(
        inputs.map(input => [
          input.id,
          { description: `Batch says ${input.name}`, model: 'gpt-6-luna' },
        ]),
      ),
  )
  const client = {
    isReady: () => ready,
    guilds: { cache: new Map(guilds.map(g => [g.id, g])) },
  }
  const service = new EmojiSyncService(
    client as unknown as Client,
    repo as unknown as EmojiDictionaryRepository,
    {
      describe: describeEmoji,
      describeBatch,
    } as unknown as EmojiDescriberService,
    dictionary as unknown as EmojiDictionaryService,
  )
  return { repo, dictionary, describeEmoji, describeBatch, client, service }
}

describe('EmojiSyncService.reconcile', () => {
  it('returns a zero summary without touching the table when the client is not ready', async () => {
    const { repo, describeEmoji, service } = setup(
      [guild('g1', [emoji('1')])],
      false,
    )

    const summary = await service.reconcile('boot')

    expect(summary).toMatchObject({
      trigger: 'boot',
      synced: 0,
      softDeleted: 0,
      seeded: 0,
      described: 0,
      failed: 0,
    })
    expect(repo.upserts).toHaveLength(0)
    expect(describeEmoji).not.toHaveBeenCalled()
  })

  it('on an empty table upserts all, seeds without the LLM and describes the rest', async () => {
    const { repo, describeEmoji, dictionary, service } = setup([
      guild('g1', [emoji(SEED_ID, 'HYPERS'), emoji('1'), emoji('2', null)]),
      guild('g2', [emoji('3')]),
    ])

    const summary = await service.reconcile('boot')

    expect(summary).toMatchObject({
      trigger: 'boot',
      synced: 3,
      softDeleted: 0,
      seeded: 1,
      described: 2,
      failed: 0,
    })
    expect(new Date(summary.finishedAt).toISOString()).toBe(summary.finishedAt)
    expect(repo.rows.get(SEED_ID)).toMatchObject({
      description: SEED_DESCRIPTION,
      source: 'manual',
      model: null,
    })
    expect(repo.rows.get('1')).toMatchObject({
      description: 'AI says emoji1',
      source: 'ai',
      model: 'gpt-6-luna',
    })
    expect(repo.rows.get('3')?.guildId).toBe('g2')
    expect(repo.rows.has('2')).toBe(false)
    expect(describeEmoji.mock.calls.map(([input]) => input.id).sort()).toEqual([
      '1',
      '3',
    ])
    // The seeded row is a manual example for the LLM calls
    expect(describeEmoji.mock.calls[0][1]).toEqual([
      { name: 'HYPERS', animated: false, description: SEED_DESCRIPTION },
    ])
    expect(dictionary.refresh).toHaveBeenCalled()
  })

  it('makes no LLM calls when everything is already described', async () => {
    const { describeEmoji, service } = setup([
      guild('g1', [emoji('1'), emoji('2')]),
    ])
    await service.reconcile('boot')
    describeEmoji.mockClear()

    const summary = await service.reconcile('cron')

    expect(describeEmoji).not.toHaveBeenCalled()
    expect(summary).toMatchObject({
      trigger: 'cron',
      synced: 2,
      seeded: 0,
      described: 0,
      failed: 0,
    })
  })

  it('a rename upserts the new name and keeps the description', async () => {
    const { repo, describeEmoji, service } = setup([
      guild('g1', [emoji('1', 'newName')]),
    ])
    repo.seed({ id: '1', name: 'oldName', description: 'kept', source: 'ai' })

    await service.reconcile('cron')

    expect(repo.rows.get('1')).toMatchObject({
      name: 'newName',
      description: 'kept',
    })
    expect(describeEmoji).not.toHaveBeenCalled()
  })

  it('soft-deletes vanished emojis but not rows of an unavailable guild', async () => {
    const { repo, service } = setup([
      guild('g1', [emoji('1')]),
      guild('g2', [], false),
    ])
    repo.seed({ id: '1', description: 'a' })
    repo.seed({ id: '2', description: 'gone' })
    repo.seed({ id: '3', guildId: 'g2', description: 'outage' })

    const summary = await service.reconcile('cron')

    expect(summary.softDeleted).toBe(1)
    expect(repo.rows.get('1')?.deletedAt).toBeNull()
    expect(repo.rows.get('2')?.deletedAt).toBeInstanceOf(Date)
    expect(repo.rows.get('3')?.deletedAt).toBeNull()
  })

  it('counts a describe failure, leaves the row NULL and carries on', async () => {
    const { repo, describeEmoji, service } = setup([
      guild('g1', [emoji('1'), emoji('2'), emoji('3')]),
    ])
    describeEmoji.mockImplementation(async input => {
      if (input.id === '2') throw new Error('boom')
      return { description: `ok ${input.id}`, model: 'gpt-6-luna' }
    })

    const summary = await service.reconcile('cron')

    expect(summary).toMatchObject({ described: 2, failed: 1 })
    expect(repo.rows.get('2')?.description).toBeNull()
    expect(repo.rows.get('3')?.description).toBe('ok 3')
  })

  it('does not count a row someone edited meanwhile', async () => {
    const { repo, describeEmoji, service } = setup([guild('g1', [emoji('1')])])
    describeEmoji.mockImplementation(async () => {
      repo.rows.get('1')!.description = 'edited by hand'
      return { description: 'ai', model: 'gpt-6-luna' }
    })

    const summary = await service.reconcile('cron')

    expect(summary).toMatchObject({ described: 0, failed: 0 })
    expect(repo.rows.get('1')?.description).toBe('edited by hand')
  })

  it('never has more than 4 describe calls in flight', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => String(i + 1))
    const { describeEmoji, service } = setup([
      guild(
        'g1',
        ids.map(id => emoji(id)),
      ),
    ])
    let inFlight = 0
    let peak = 0
    describeEmoji.mockImplementation(async input => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setTimeout(resolve, 1))
      inFlight--
      return { description: input.id, model: 'gpt-6-luna' }
    })

    const summary = await service.reconcile('cron')

    expect(summary.described).toBe(12)
    expect(peak).toBe(4)
  })

  it('shares one run between concurrent calls', async () => {
    const { repo, describeEmoji, service } = setup([guild('g1', [emoji('1')])])
    const gate = deferred()
    describeEmoji.mockImplementation(async () => {
      await gate.promise
      return { description: 'x', model: 'gpt-6-luna' }
    })

    const first = service.reconcile('boot')
    const second = service.reconcile('admin')
    expect(second).toBe(first)
    gate.resolve()

    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    expect(a.trigger).toBe('boot')
    expect(repo.upserts).toHaveLength(1)
    expect(describeEmoji).toHaveBeenCalledTimes(1)
  })
})

describe('EmojiSyncService event handlers', () => {
  it('syncEmoji upserts the emoji and describes it', async () => {
    const { repo, dictionary, service } = setup()

    await service.syncEmoji({
      id: '9',
      name: 'fresh',
      animated: true,
      guild: { id: 'g1' },
    } as unknown as GuildEmoji)

    expect(repo.rows.get('9')).toMatchObject({
      guildId: 'g1',
      name: 'fresh',
      animated: true,
      description: 'AI says fresh',
      source: 'ai',
    })
    expect(dictionary.refresh).toHaveBeenCalled()
  })

  it('syncEmoji waits for a running reconcile', async () => {
    const { repo, describeEmoji, service } = setup([guild('g1', [emoji('1')])])
    const gate = deferred()
    describeEmoji.mockImplementationOnce(async () => {
      await gate.promise
      return { description: 'x', model: 'gpt-6-luna' }
    })

    const reconcile = service.reconcile('boot')
    const sync = service.syncEmoji({
      id: '9',
      name: 'fresh',
      animated: false,
      guild: { id: 'g1' },
    } as unknown as GuildEmoji)
    await new Promise(resolve => setTimeout(resolve, 5))

    expect(repo.rows.has('9')).toBe(false)
    gate.resolve()
    await Promise.all([reconcile, sync])
    expect(repo.rows.get('9')?.description).toBe('AI says fresh')
  })

  it('removeEmoji soft-deletes and refreshes the dictionary', async () => {
    const { repo, dictionary, service } = setup()
    repo.seed({ id: '1', description: 'a' })

    await service.removeEmoji('1')

    expect(repo.rows.get('1')?.deletedAt).toBeInstanceOf(Date)
    expect(dictionary.refresh).toHaveBeenCalledTimes(1)
  })
})

describe('EmojiSyncService.redescribe', () => {
  it('overwrites a manual description with an AI one, ignoring the seed', async () => {
    const { repo, describeEmoji, dictionary, service } = setup()
    repo.seed({
      id: SEED_ID,
      name: 'HYPERS',
      description: 'hand written',
      source: 'manual',
    })

    const row = await service.redescribe(SEED_ID)

    expect(describeEmoji).toHaveBeenCalledTimes(1)
    expect(describeEmoji.mock.calls[0][1]).toEqual([
      { name: 'HYPERS', animated: false, description: 'hand written' },
    ])
    expect(row).toMatchObject({
      description: 'AI says HYPERS',
      source: 'ai',
      model: 'gpt-6-luna',
    })
    expect(dictionary.refresh).toHaveBeenCalledTimes(1)
  })

  it('throws EmojiNotFoundError for an unknown id', async () => {
    const { service } = setup()

    await expect(service.redescribe('nope')).rejects.toBeInstanceOf(
      EmojiNotFoundError,
    )
  })

  it('throws EmojiDeletedError for a deleted emoji', async () => {
    const { repo, describeEmoji, service } = setup()
    repo.seed({ id: '1', deletedAt: new Date() })

    await expect(service.redescribe('1')).rejects.toBeInstanceOf(
      EmojiDeletedError,
    )
    expect(describeEmoji).not.toHaveBeenCalled()
  })

  it('propagates describer errors', async () => {
    const { repo, describeEmoji, service } = setup()
    repo.seed({ id: '1' })
    describeEmoji.mockRejectedValue(new Error('llm down'))

    await expect(service.redescribe('1')).rejects.toThrow('llm down')
    expect(repo.rows.get('1')?.description).toBeNull()
  })
})

describe('EmojiSyncService.redescribeAll', () => {
  function seedMany(repo: FakeRepo, count: number) {
    for (let i = 1; i <= count; i++) {
      repo.seed({
        id: String(i),
        name: `e${i}`,
        description: `old ${i}`,
        source: i % 2 ? 'manual' : 'ai',
      })
    }
  }

  it('rewrites every live description, hand-written ones included, in batches', async () => {
    const { repo, describeBatch, describeEmoji, dictionary, service } = setup()
    seedMany(repo, 45)
    repo.seed({ id: 'gone', description: 'keep me', deletedAt: new Date() })

    const summary = await service.redescribeAll()

    expect(describeBatch.mock.calls.map(([batch]) => batch.length)).toEqual([
      20, 20, 5,
    ])
    expect(describeEmoji).not.toHaveBeenCalled()
    expect(summary).toMatchObject({
      trigger: 'redescribe-all',
      described: 45,
      failed: 0,
    })
    expect(repo.rows.get('1')).toMatchObject({
      description: 'Batch says e1',
      source: 'ai',
      model: 'gpt-6-luna',
    })
    expect(repo.rows.get('gone')?.description).toBe('keep me')
    expect(dictionary.refresh).toHaveBeenCalled()
    expect(service.status().last).toBe(summary)
  })

  it('uses the manual descriptions as examples, as they were before the run', async () => {
    const { repo, describeBatch, service } = setup()
    seedMany(repo, 3)

    await service.redescribeAll()

    expect(describeBatch.mock.calls[0][1]).toEqual([
      { name: 'e1', animated: false, description: 'old 1' },
      { name: 'e3', animated: false, description: 'old 3' },
    ])
  })

  it('retries emojis the batch skipped one by one', async () => {
    const { repo, describeBatch, describeEmoji, service } = setup()
    seedMany(repo, 3)
    describeBatch.mockImplementation(
      async inputs =>
        new Map(
          inputs
            .filter(input => input.id !== '2')
            .map(input => [
              input.id,
              { description: 'batched', model: 'gpt-6-luna' },
            ]),
        ),
    )

    const summary = await service.redescribeAll()

    expect(describeEmoji).toHaveBeenCalledTimes(1)
    expect(describeEmoji.mock.calls[0][0]).toMatchObject({ id: '2' })
    expect(summary).toMatchObject({ described: 3, failed: 0 })
    expect(repo.rows.get('2')?.description).toBe('AI says e2')
    expect(repo.rows.get('1')?.description).toBe('batched')
  })

  it('falls back to one-by-one when the whole batch call fails', async () => {
    const { repo, describeBatch, describeEmoji, service } = setup()
    seedMany(repo, 3)
    describeBatch.mockRejectedValue(new Error('bad image'))
    describeEmoji.mockImplementation(async input => {
      if (input.id === '2') throw new Error('still bad')
      return { description: `solo ${input.id}`, model: 'gpt-6-luna' }
    })

    const summary = await service.redescribeAll()

    expect(summary).toMatchObject({ described: 2, failed: 1 })
    expect(repo.rows.get('1')?.description).toBe('solo 1')
    expect(repo.rows.get('2')?.description).toBe('old 2')
  })

  it('shares the one-run guard with reconcile', async () => {
    const { repo, describeBatch, service } = setup()
    seedMany(repo, 1)
    const gate = deferred()
    describeBatch.mockImplementation(async inputs => {
      await gate.promise
      return new Map(
        inputs.map(i => [i.id, { description: 'x', model: 'gpt-6-luna' }]),
      )
    })

    const first = service.redescribeAll()
    expect(service.status().running).toBe(true)
    expect(service.reconcile('admin')).toBe(first)
    expect(service.redescribeAll()).toBe(first)
    gate.resolve()
    await first

    expect(describeBatch).toHaveBeenCalledTimes(1)
  })

  it('does nothing when there are no live emojis', async () => {
    const { describeBatch, service } = setup()

    const summary = await service.redescribeAll()

    expect(describeBatch).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ described: 0, failed: 0 })
  })
})

describe('EmojiSyncService.status', () => {
  it('reports running and the last summary', async () => {
    const { describeEmoji, service } = setup([guild('g1', [emoji('1')])])
    expect(service.status()).toEqual({ running: false, last: null })
    const gate = deferred()
    describeEmoji.mockImplementation(async () => {
      await gate.promise
      return { description: 'x', model: 'gpt-6-luna' }
    })

    const run = service.reconcile('admin')
    expect(service.status().running).toBe(true)
    gate.resolve()
    const summary = await run

    expect(service.status()).toEqual({ running: false, last: summary })
  })
})
