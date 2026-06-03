// UI-facing domain types: opaque aliases for Drizzle row types. A future schema
// rename flows through to consumers, and the alias gives a seam to introduce a
// richer domain shape without rewriting every importer.

import type {
  exercises,
  progressions,
  routines,
  sessions,
  setLogs,
} from 'src/db/schema'

export type ExerciseRow = typeof exercises.$inferSelect
export type RoutineRow = typeof routines.$inferSelect
export type SessionRow = typeof sessions.$inferSelect
export type CompletedSessionRow = SessionRow & { completedAt: Date }

export function isCompletedSession(s: SessionRow): s is CompletedSessionRow {
  return s.completedAt !== null
}
export type SetLogRow = typeof setLogs.$inferSelect
export type ProgressionRow = typeof progressions.$inferSelect
