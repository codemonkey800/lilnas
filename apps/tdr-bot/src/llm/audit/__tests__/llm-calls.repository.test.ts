import { PgDialect } from 'drizzle-orm/pg-core'

import { DrizzleService } from 'src/db/drizzle.service'
import { LlmCallsRepository } from 'src/llm/audit/llm-calls.repository'

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
    'groupBy',
    'insert',
    'values',
  ]) {
    chain[method] = jest.fn((...args: unknown[]) => {
      calls.push({ method, args })
      return chain
    })
  }
  ;(chain as unknown as PromiseLike<unknown>).then = ((
    resolve: (v: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve)) as never
  const repo = new LlmCallsRepository({
    db: chain,
  } as unknown as DrizzleService)
  return { repo, calls }
}

const dialect = new PgDialect()
const sqlOf = (arg: unknown) => dialect.sqlToQuery(arg as never)

describe('LlmCallsRepository', () => {
  it('inserts the row', async () => {
    const { repo, calls } = fakeDb(undefined)
    const row = { id: 'a', operation: 'x', model: 'm', status: 'success' }
    await repo.insert(row)
    expect(calls.map(c => c.method)).toEqual(['insert', 'values'])
    expect(calls[1].args[0]).toBe(row)
  })

  it('lists a channel newest first with range and limit', async () => {
    const { repo, calls } = fakeDb([{ id: 'a' }])
    const from = new Date('2026-01-01')
    const to = new Date('2026-02-01')
    const rows = await repo.listByChannel('c1', { from, to, limit: 5 })
    expect(rows).toEqual([{ id: 'a' }])
    const where = sqlOf(calls.find(c => c.method === 'where')?.args[0])
    expect(where.sql).toContain('"channel_id" = $1')
    expect(where.sql).toContain('"created_at" >=')
    expect(where.sql).toContain('"created_at" <=')
    expect(where.params).toEqual(['c1', from.toISOString(), to.toISOString()])
    expect(sqlOf(calls.find(c => c.method === 'orderBy')?.args[0]).sql).toMatch(
      /desc/,
    )
    expect(calls.find(c => c.method === 'limit')?.args).toEqual([5])
  })

  it('omits range conditions when none given', async () => {
    const { repo, calls } = fakeDb([])
    await repo.listByChannel('c1', { limit: 1 })
    const where = sqlOf(calls.find(c => c.method === 'where')?.args[0])
    expect(where.params).toEqual(['c1'])
  })

  it('aggregates totals into numbers', async () => {
    const { repo, calls } = fakeDb([
      {
        calls: 3,
        inputTokens: '30',
        outputTokens: '10',
        cachedTokens: '5',
        costUsd: '0.012000',
      },
    ])
    const from = new Date('2026-01-01')
    const to = new Date('2026-02-01')
    const totals = await repo.totals({ from, to })
    expect(totals).toEqual({
      calls: 3,
      inputTokens: 30,
      outputTokens: 10,
      cachedTokens: 5,
      costUsd: 0.012,
    })
    const where = sqlOf(calls.find(c => c.method === 'where')?.args[0])
    expect(where.params).toEqual([from.toISOString(), to.toISOString()])
  })

  it('returns zero totals for an empty table', async () => {
    const { repo } = fakeDb([])
    expect(await repo.totals({ from: new Date(), to: new Date() })).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      costUsd: 0,
    })
  })

  it('groups recent channels by last activity', async () => {
    const lastAt = new Date('2026-01-01')
    const { repo, calls } = fakeDb([
      { channelId: 'c1', lastAt, calls: 4 },
      { channelId: null, lastAt, calls: 1 },
    ])
    const rows = await repo.recentChannels(10)
    expect(rows).toEqual([{ channelId: 'c1', lastAt, calls: 4 }])
    expect(calls.map(c => c.method)).toEqual([
      'select',
      'from',
      'where',
      'groupBy',
      'orderBy',
      'limit',
    ])
    expect(calls[5].args).toEqual([10])
  })
})
