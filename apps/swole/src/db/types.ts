// UI-facing domain types. These are opaque aliases for the Drizzle row types
// so consumers depend on `Exercise`, `Routine`, etc. rather than the column-
// level `$inferSelect` output. A future schema rename for any column would
// still flow through to consumers, but the alias gives us a single seam to
// introduce a richer domain shape (e.g. dropping `archivedAt` from the public
// surface) without rewriting every importer.

import type {
  exercises,
  progressions,
  routines,
  sessions,
  setLogs,
} from 'src/db/schema'

export type Exercise = typeof exercises.$inferSelect
export type Routine = typeof routines.$inferSelect
export type Session = typeof sessions.$inferSelect
export type SetLog = typeof setLogs.$inferSelect
export type Progression = typeof progressions.$inferSelect

// Re-exported under the legacy `*Row` names so the migration from
// `import { ExerciseRow } from 'src/db/queries/exercises'` to
// `import type { ExerciseRow } from 'src/db/types'` is a single rewrite.
export type ExerciseRow = Exercise
export type RoutineRow = Routine
export type SessionRow = Session
export type SetLogRow = SetLog
export type ProgressionRow = Progression
