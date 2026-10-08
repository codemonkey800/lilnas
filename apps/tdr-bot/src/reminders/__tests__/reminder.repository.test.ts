import { PgDialect } from 'drizzle-orm/pg-core'

import { DrizzleService } from 'src/db/drizzle.service'
import { ReminderRepository } from 'src/reminders/reminder.repository'

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
    'update',
    'set',
    'delete',
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
  const repo = new ReminderRepository({
    db: chain,
  } as unknown as DrizzleService)
  return { repo, calls }
}

const dialect = new PgDialect()
const sqlOf = (arg: unknown) => dialect.sqlToQuery(arg as never)
const argOf = (calls: Array<{ method: string; args: unknown[] }>, m: string) =>
  calls.find(c => c.method === m)?.args[0]
const orderSql = (calls: Array<{ method: string; args: unknown[] }>) =>
  calls
    .find(c => c.method === 'orderBy')
    ?.args.map(a => sqlOf(a).sql)
    .join(', ')

describe('ReminderRepository', () => {
  it('inserts and returns the created row', async () => {
    const { repo, calls } = fakeDb([{ id: 'a' }])
    const row = { id: 'a', userId: 'u', what: 'x' }
    expect(await repo.insert(row)).toEqual({ id: 'a' })
    expect(calls.map(c => c.method)).toEqual(['insert', 'values', 'returning'])
    expect(argOf(calls, 'values')).toBe(row)
  })

  it('finds by id and returns null when missing', async () => {
    const { repo, calls } = fakeDb([])
    expect(await repo.findById('a')).toBeNull()
    const where = sqlOf(argOf(calls, 'where'))
    expect(where.sql).toContain('"id" = $1')
    expect(where.params).toEqual(['a'])
  })

  it('lists active by default, ordered by next run nulls last then newest', async () => {
    const { repo, calls } = fakeDb([])
    await repo.list({})
    const where = sqlOf(argOf(calls, 'where'))
    expect(where.sql).toContain('"status" = $1')
    expect(where.params).toEqual(['active'])
    expect(orderSql(calls)).toMatch(/"next_run_at" ASC NULLS LAST/)
    expect(orderSql(calls)).toMatch(/"created_at" desc/)
    expect(calls.some(c => c.method === 'limit')).toBe(false)
  })

  it('filters by user, status all, and limit', async () => {
    const { repo, calls } = fakeDb([])
    await repo.list({ status: 'all', userId: 'u1', limit: 10 })
    const where = sqlOf(argOf(calls, 'where'))
    expect(where.sql).not.toContain('"status"')
    expect(where.sql).toContain('"user_id" = $1')
    expect(where.params).toEqual(['u1'])
    expect(calls.find(c => c.method === 'limit')?.args).toEqual([10])
  })

  it('filters by a specific status', async () => {
    const { repo, calls } = fakeDb([])
    await repo.list({ status: 'missed' })
    expect(sqlOf(argOf(calls, 'where')).params).toEqual(['missed'])
  })

  it('lists active reminders created by or targeting a user', async () => {
    const { repo, calls } = fakeDb([])
    await repo.listActiveForUser('u1')
    const where = sqlOf(argOf(calls, 'where'))
    expect(where.sql).toContain('"status" = $1')
    expect(where.sql).toContain('"user_id" = $2')
    expect(where.sql).toContain('"target_user_id" = $3')
    expect(where.sql).toContain(' or ')
    expect(where.params).toEqual(['active', 'u1', 'u1'])
  })

  it('counts active reminders created by a user', async () => {
    const { repo, calls } = fakeDb([{ value: '4' }])
    expect(await repo.countActiveCreatedBy('u1')).toBe(4)
    const where = sqlOf(argOf(calls, 'where'))
    expect(where.sql).toContain('"status" = $1')
    expect(where.sql).toContain('"user_id" = $2')
    expect(where.params).toEqual(['active', 'u1'])
  })

  it('lists due reminders oldest first with a limit', async () => {
    const { repo, calls } = fakeDb([])
    const now = new Date('2026-10-07T12:00:00Z')
    await repo.listDue(now, 50)
    const where = sqlOf(argOf(calls, 'where'))
    expect(where.sql).toContain('"status" = $1')
    expect(where.sql).toContain('"next_run_at" <= $2')
    expect(where.params).toEqual(['active', now.toISOString()])
    expect(orderSql(calls)).toMatch(/"next_run_at"/)
    expect(orderSql(calls)).not.toMatch(/desc/)
    expect(calls.find(c => c.method === 'limit')?.args).toEqual([50])
  })

  it('lists active reminders without a next run', async () => {
    const { repo, calls } = fakeDb([])
    await repo.listActiveWithoutNextRun()
    const where = sqlOf(argOf(calls, 'where'))
    expect(where.sql).toContain('"status" = $1')
    expect(where.sql).toContain('"next_run_at" is null')
  })

  it('updates with a fresh updatedAt and returns null when missing', async () => {
    const { repo, calls } = fakeDb([])
    const before = Date.now()
    expect(await repo.update('a', { what: 'new' })).toBeNull()
    const set = argOf(calls, 'set') as { what: string; updatedAt: Date }
    expect(set.what).toBe('new')
    expect(set.updatedAt.getTime()).toBeGreaterThanOrEqual(before)
    const where = sqlOf(argOf(calls, 'where'))
    expect(where.sql).toContain('"id" = $1')
  })

  it('advances only while the row is active with the expected nextRunAt', async () => {
    const { repo, calls } = fakeDb([])
    const expected = new Date('2026-06-01T12:00:00Z')
    expect(
      await repo.advanceIfActive('a', expected, { runCount: 2 }),
    ).toBeNull()
    const where = sqlOf(argOf(calls, 'where'))
    expect(where.sql).toContain('"id" = $1')
    expect(where.sql).toContain('"status" = $2')
    expect(where.sql).toContain('"next_run_at" = $3')
    expect(where.params).toEqual(['a', 'active', expected.toISOString()])
  })

  it('counts active reminders by type', async () => {
    const { repo, calls } = fakeDb([
      { isRecurring: true, value: 2 },
      { isRecurring: false, value: '5' },
    ])
    expect(await repo.countActiveByType()).toEqual({ recurring: 2, oneTime: 5 })
    expect(sqlOf(argOf(calls, 'where')).params).toEqual(['active'])
    expect(calls.some(c => c.method === 'groupBy')).toBe(true)
  })

  it('deletes finished reminders older than the cutoff', async () => {
    const { repo, calls } = fakeDb([{ id: 'a' }, { id: 'b' }])
    const cutoff = new Date('2026-07-01T00:00:00Z')
    expect(await repo.deleteFinishedBefore(cutoff)).toBe(2)
    const where = sqlOf(argOf(calls, 'where'))
    expect(where.sql).toContain('"status" in ($1, $2, $3)')
    expect(where.sql).toContain('"updated_at" < $4')
    expect(where.params).toEqual([
      'completed',
      'cancelled',
      'missed',
      cutoff.toISOString(),
    ])
  })
})
