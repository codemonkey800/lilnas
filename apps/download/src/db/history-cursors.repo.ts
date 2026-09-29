import { eq } from 'drizzle-orm'

import type { Db } from './db.service'
import { type ArrApp, arrHistoryCursors } from './schema'

/**
 * How far one app's history has been applied: the newest event `date` seen,
 * and the ids of every event already applied at exactly that date. See the
 * `arr_history_cursors` banner in schema.ts for why a single id can't do.
 */
export interface HistoryCursor {
  date: string
  ids: number[]
}

function parseDate(date: string): number {
  const ms = Date.parse(date)
  if (Number.isNaN(ms)) {
    throw new Error(`history cursor date is not a date: '${date}'`)
  }
  return ms
}

/** Sorted and de-duplicated, so the stored JSON is stable for a given set. */
function normalizeIds(ids: Iterable<number>): number[] {
  return Array.from(new Set(ids)).sort((a, b) => a - b)
}

/** The stored cursor for `app`, or `undefined` if its history was never read. */
export function getCursor(db: Db, app: ArrApp): HistoryCursor | undefined {
  const row = db
    .select()
    .from(arrHistoryCursors)
    .where(eq(arrHistoryCursors.app, app))
    .get()

  return row ? { date: row.cursorDate, ids: row.cursorIds } : undefined
}

/**
 * Advances `app`'s cursor after a batch of history has been applied:
 *
 * - a `date` later than the stored one replaces the stored ids outright -
 *   nothing at the old date can be re-fetched once the read starts past it;
 * - an equal `date` unions the ids, since a tie can span two reads (a record
 *   landing in the same second after the first read) and forgetting the
 *   first read's ids would replay them;
 * - an earlier `date` is ignored - the cursor never moves backwards, so a
 *   stale or out-of-order caller can't make the next read replay history.
 *
 * Dates are compared as instants (`Date.parse`), not as strings, so two
 * spellings of one moment count as equal; on a tie the stored spelling is
 * kept. Read-then-write inside one transaction. Returns the cursor as stored.
 */
export function setCursor(
  db: Db,
  app: ArrApp,
  date: string,
  ids: readonly number[],
): HistoryCursor {
  const incomingMs = parseDate(date)

  // The outer `db` inside the callback, as jobs.repo.ts does: better-sqlite3
  // is synchronous on one connection, so every statement here runs inside
  // the transaction anyway.
  return db.transaction(() => {
    const existing = getCursor(db, app)

    let next: HistoryCursor
    if (!existing) {
      next = { date, ids: normalizeIds(ids) }
    } else {
      const storedMs = parseDate(existing.date)
      if (incomingMs < storedMs) return existing
      next =
        incomingMs > storedMs
          ? { date, ids: normalizeIds(ids) }
          : {
              date: existing.date,
              ids: normalizeIds([...existing.ids, ...ids]),
            }
    }

    db.insert(arrHistoryCursors)
      .values({ app, cursorDate: next.date, cursorIds: next.ids })
      .onConflictDoUpdate({
        set: { cursorDate: next.date, cursorIds: next.ids },
        target: arrHistoryCursors.app,
      })
      .run()

    return next
  })
}
