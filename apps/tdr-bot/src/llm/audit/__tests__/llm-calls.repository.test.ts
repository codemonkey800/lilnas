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

  it("lists a channel's calls for the given requests oldest first", async () => {
    const { repo, calls } = fakeDb([{ id: 'a' }])
    const rows = await repo.listByRequestIds('c1', ['r1', 'r2'])
    expect(rows).toEqual([{ id: 'a' }])
    const where = sqlOf(calls.find(c => c.method === 'where')?.args[0])
    expect(where.sql).toContain('"channel_id" = $1')
    expect(where.sql).toContain('"request_id" in ($2, $3)')
    expect(where.params).toEqual(['c1', 'r1', 'r2'])
    expect(sqlOf(calls.find(c => c.method === 'orderBy')?.args[0]).sql).toMatch(
      /asc/,
    )
  })

  it('skips the query when there are no request ids', async () => {
    const { repo, calls } = fakeDb([{ id: 'a' }])
    expect(await repo.listByRequestIds('c1', [])).toEqual([])
    expect(calls).toEqual([])
  })

  it("sums a channel's totals within the range", async () => {
    const { repo, calls } = fakeDb([
      { inputTokens: '30', outputTokens: '10', costUsd: '0.012000' },
    ])
    const from = new Date('2026-01-01')
    const totals = await repo.totalsByChannel('c1', { from })
    expect(totals).toEqual({
      costUsd: 0.012,
      inputTokens: 30,
      outputTokens: 10,
    })
    const where = sqlOf(calls.find(c => c.method === 'where')?.args[0])
    expect(where.sql).toContain('"channel_id" = $1')
    expect(where.params).toEqual(['c1', from.toISOString()])
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
