import type BetterSqlite3 from 'better-sqlite3'

// PRAGMA order is load-bearing. `journal_mode = WAL` has side effects on the
// file format and should be set first; `foreign_keys = ON` must be set after
// the connection opens but before any query runs (otherwise ON DELETE RESTRICT
// silently degrades to no-op).
export function applyPragmas(sqlite: BetterSqlite3.Database): void {
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
}
