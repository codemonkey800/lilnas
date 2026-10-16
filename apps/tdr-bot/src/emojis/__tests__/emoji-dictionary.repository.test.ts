import { PgDialect } from 'drizzle-orm/pg-core'

import { DrizzleService } from 'src/db/drizzle.service'
import { emojiDictionary } from 'src/db/schema'
import { EmojiDictionaryRepository } from 'src/emojis/emoji-dictionary.repository'

interface Chain {
  [method: string]: jest.Mock
}

/** Fake Drizzle: every builder method returns the chain; awaiting yields `result`. */
function fakeDb(result: unknown) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const chain: Chain = {}
  for (const method of [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'insert',
    'values',
    'onConflictDoUpdate',
    'update',
    'set',
    'returning',
  ]) {
    chain[method] = jest.fn((...args: unknown[]) => {
      calls.push({ method, args })
      return chain
    })
  }
  ;(chain as unknown as PromiseLike<unknown>).then = ((
    resolve: (v: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve)) as never
  const repo = new EmojiDictionaryRepository({
    db: chain,
  } as unknown as DrizzleService)
  const argOf = (method: string) =>
    calls.find(c => c.method === method)?.args[0]
  return { repo, calls, argOf }
}

const dialect = new PgDialect()
const sqlOf = (arg: unknown) => dialect.sqlToQuery(arg as never)

const description = {
  description: 'a crying cat',
  source: 'ai' as const,
  model: 'gpt-x',
}

describe('EmojiDictionaryRepository', () => {
  describe('upsertMeta', () => {
    it('upserts on id, refreshing metadata and clearing deleted_at only', async () => {
      const { repo, calls, argOf } = fakeDb(undefined)
      const rows = [{ id: '1', guildId: 'g', name: 'cry', animated: false }]
      await repo.upsertMeta(rows)

      expect(calls.map(c => c.method)).toEqual([
        'insert',
        'values',
        'onConflictDoUpdate',
      ])
      expect(argOf('insert')).toBe(emojiDictionary)
      expect(argOf('values')).toBe(rows)
      const conflict = argOf('onConflictDoUpdate') as {
        target: unknown
        set: Record<string, unknown>
      }
      expect(conflict.target).toBe(emojiDictionary.id)
      expect(Object.keys(conflict.set).sort()).toEqual([
        'animated',
        'deletedAt',
        'guildId',
        'name',
        'updatedAt',
      ])
      for (const column of ['description', 'source', 'model', 'describedAt']) {
        expect(conflict.set).not.toHaveProperty(column)
      }
      expect(conflict.set.deletedAt).toBeNull()
      expect(sqlOf(conflict.set.guildId).sql).toBe('excluded.guild_id')
      expect(sqlOf(conflict.set.name).sql).toBe('excluded.name')
      expect(sqlOf(conflict.set.animated).sql).toBe('excluded.animated')
      expect(sqlOf(conflict.set.updatedAt).sql).toBe('now()')
    })

    it('is a no-op for no rows', async () => {
      const { repo, calls } = fakeDb(undefined)
      await repo.upsertMeta([])
      expect(calls).toEqual([])
    })
  })

  describe('softDeleteMissing', () => {
    it('deletes live rows outside keepIds and the skipped guilds', async () => {
      const { repo, argOf } = fakeDb([{ id: '3' }, { id: '4' }])
      const count = await repo.softDeleteMissing(['1', '2'], ['g1'])

      expect(count).toBe(2)
      expect(Object.keys(argOf('set') as object).sort()).toEqual([
        'deletedAt',
        'updatedAt',
      ])
      const where = sqlOf(argOf('where'))
      expect(where.sql).toContain('"deleted_at" is null')
      expect(where.sql).toContain('"id" not in ($1, $2)')
      expect(where.sql).toContain('"guild_id" not in ($3)')
      expect(where.params).toEqual(['1', '2', 'g1'])
    })

    it('adds no guild filter without skip guilds', async () => {
      const { repo, argOf } = fakeDb([])
      expect(await repo.softDeleteMissing(['1'], [])).toBe(0)
      const where = sqlOf(argOf('where'))
      expect(where.sql).not.toContain('guild_id')
      expect(where.params).toEqual(['1'])
    })

    it('deletes every live row when keepIds is empty', async () => {
      const { repo, argOf } = fakeDb([{ id: '1' }])
      expect(await repo.softDeleteMissing([], [])).toBe(1)
      const where = sqlOf(argOf('where'))
      expect(where.sql).toBe('"emoji_dictionary"."deleted_at" is null')
      expect(where.params).toEqual([])
    })

    it('still honours skip guilds when keepIds is empty', async () => {
      const { repo, argOf } = fakeDb([])
      await repo.softDeleteMissing([], ['g1'])
      const where = sqlOf(argOf('where'))
      expect(where.sql).not.toContain('"id" not in')
      expect(where.sql).toContain('"guild_id" not in ($1)')
    })
  })

  it('softDelete only touches a live row', async () => {
    const { repo, argOf } = fakeDb(undefined)
    await repo.softDelete('1')
    const where = sqlOf(argOf('where'))
    expect(where.sql).toContain('"id" = $1')
    expect(where.sql).toContain('"deleted_at" is null')
    expect(where.params).toEqual(['1'])
  })

  describe('lists', () => {
    it('listUndescribed filters to live rows with no description', async () => {
      const { repo, argOf } = fakeDb([{ id: '1' }])
      expect(await repo.listUndescribed()).toEqual([{ id: '1' }])
      const where = sqlOf(argOf('where')).sql
      expect(where).toContain('"description" is null')
      expect(where).toContain('"deleted_at" is null')
    })

    it('listActiveDescribed filters to live described rows', async () => {
      const { repo, argOf } = fakeDb([])
      await repo.listActiveDescribed()
      const where = sqlOf(argOf('where')).sql
      expect(where).toContain('"description" is not null')
      expect(where).toContain('"deleted_at" is null')
    })

    it('listAll has no filter', async () => {
      const { repo, calls } = fakeDb([{ id: '1' }, { id: '2' }])
      expect(await repo.listAll()).toHaveLength(2)
      expect(calls.some(c => c.method === 'where')).toBe(false)
    })

    it('listManualExamples filters, orders by id and limits', async () => {
      const { repo, argOf } = fakeDb([])
      await repo.listManualExamples(5)
      const where = sqlOf(argOf('where'))
      expect(where.sql).toContain('"source" = $1')
      expect(where.sql).toContain('"description" is not null')
      expect(where.sql).toContain('"deleted_at" is null')
      expect(where.params).toEqual(['manual'])
      expect(sqlOf(argOf('orderBy')).sql).toContain('"id" asc')
      expect(argOf('limit')).toBe(5)
    })
  })

  describe('get', () => {
    it('returns the row', async () => {
      const { repo, argOf } = fakeDb([{ id: '1' }])
      expect(await repo.get('1')).toEqual({ id: '1' })
      expect(sqlOf(argOf('where')).params).toEqual(['1'])
    })

    it('returns undefined for an unknown id', async () => {
      const { repo } = fakeDb([])
      expect(await repo.get('nope')).toBeUndefined()
    })
  })

  describe('fillDescription', () => {
    it('only fills a row with no description', async () => {
      const { repo, argOf } = fakeDb([{ id: '1' }])
      expect(await repo.fillDescription('1', description)).toBe(true)
      const set = argOf('set') as Record<string, unknown>
      expect(set).toMatchObject(description)
      expect(sqlOf(set.describedAt).sql).toBe('now()')
      expect(sqlOf(set.updatedAt).sql).toBe('now()')
      const where = sqlOf(argOf('where'))
      expect(where.sql).toContain('"id" = $1')
      expect(where.sql).toContain('"description" is null')
    })

    it('returns false when no row changed', async () => {
      const { repo } = fakeDb([])
      expect(await repo.fillDescription('1', description)).toBe(false)
    })
  })

  describe('setDescription', () => {
    it('overwrites unconditionally and returns the row', async () => {
      const { repo, argOf } = fakeDb([{ id: '1', ...description }])
      expect(await repo.setDescription('1', description)).toEqual({
        id: '1',
        ...description,
      })
      expect(argOf('set')).toMatchObject(description)
      const where = sqlOf(argOf('where'))
      expect(where.sql).not.toContain('description')
      expect(where.params).toEqual(['1'])
    })

    it('returns undefined for an unknown id', async () => {
      const { repo } = fakeDb([])
      expect(await repo.setDescription('nope', description)).toBeUndefined()
    })
  })
})
