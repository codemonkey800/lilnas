// Tagged error classes the data layer throws for invariants that callers must
// distinguish from generic SqliteError. Keeping them in one module avoids
// circular imports between mutation files that surface the same error from
// different code paths.
//
// Every error extends `DataLayerError` and carries a `kind` discriminator.
// Server actions serialize it into a `{ ok: false; kind; code }` result
// envelope so the discriminant survives the RSC serialization boundary.
// Within the server, `instanceof` remains the primary dispatch mechanism.

export type DataLayerErrorKind =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'forbidden_transition'
  | 'hydration'

export abstract class DataLayerError extends Error {
  abstract readonly kind: DataLayerErrorKind
  constructor(message: string) {
    super(message)
    // Preserves `err.name === 'ConcreteName'` without each subclass restating it.
    this.name = this.constructor.name
  }
}

export class ValidationError extends DataLayerError {
  readonly kind = 'validation' as const
  constructor(message: string) {
    super(message)
  }
}

export class NotFoundError extends DataLayerError {
  readonly kind = 'not_found' as const
  readonly entity: string
  readonly entityId: number
  constructor(entity: string, id: number) {
    super(`${entity} not found: ${id}`)
    this.entity = entity
    this.entityId = id
  }
}

export class RoutineAlreadyHasActiveSession extends DataLayerError {
  readonly kind = 'conflict' as const
  readonly routineId: number
  constructor(routineId: number) {
    super(`Routine ${routineId} already has an active (incomplete) session`)
    this.routineId = routineId
  }
}

export class DuplicateSetLog<T = unknown> extends DataLayerError {
  readonly kind = 'conflict' as const
  readonly existing: T
  constructor(existing: T) {
    super(
      'A set_log with this (sessionId, exerciseId, setNumber) already exists',
    )
    this.existing = existing
  }
}

export class ArchiveBlockedByActiveSession extends DataLayerError {
  readonly kind = 'forbidden_transition' as const
  readonly entity: string
  readonly entityId: number
  constructor(entity: string, id: number) {
    super(
      `Cannot archive ${entity} ${id} while an active session references its routine`,
    )
    this.entity = entity
    this.entityId = id
  }
}

export class ReorderBlockedByActiveSession extends DataLayerError {
  readonly kind = 'forbidden_transition' as const
  readonly routineId: number
  constructor(routineId: number) {
    super(
      `Cannot reorder exercises on routine ${routineId} while an active session is in progress`,
    )
    this.routineId = routineId
  }
}

export class EditBlockedByActiveSession extends DataLayerError {
  readonly kind = 'forbidden_transition' as const
  readonly routineId: number
  constructor(routineId: number) {
    super(
      `Cannot edit routine ${routineId} while an active session is in progress`,
    )
    this.routineId = routineId
  }
}

export class UndoBlockedByCommittedProgression extends DataLayerError {
  readonly kind = 'forbidden_transition' as const
  readonly sessionId: number
  constructor(sessionId: number) {
    super(
      `Cannot undo set_log on session ${sessionId}: a session_progression decision has already been committed`,
    )
    this.sessionId = sessionId
  }
}

export class SessionAlreadyCompleted extends DataLayerError {
  readonly kind = 'forbidden_transition' as const
  readonly sessionId: number
  constructor(sessionId: number) {
    super(`Session ${sessionId} is already completed`)
    this.sessionId = sessionId
  }
}

export class RoutineArchived extends DataLayerError {
  readonly kind = 'forbidden_transition' as const
  readonly routineId: number
  constructor(routineId: number) {
    super(`Routine ${routineId} is archived`)
    this.routineId = routineId
  }
}

export class UndoBlockedBySessionCompleted extends DataLayerError {
  readonly kind = 'forbidden_transition' as const
  readonly sessionId: number
  constructor(sessionId: number) {
    super(
      `Cannot undo set_log on session ${sessionId}: session is already completed`,
    )
    this.sessionId = sessionId
  }
}

// Thrown when the DB → FSM mapper can't reconstruct a domain shape from a row
// (missing required column for the exercise type, row references an exercise
// not in the routine, etc.). Lives here so all tagged errors are in one place.
export class HydrationError extends DataLayerError {
  readonly kind = 'hydration' as const
  constructor(message: string) {
    super(message)
  }
}

export class RoutineNotArchived extends DataLayerError {
  readonly kind = 'forbidden_transition' as const
  readonly routineId: number
  constructor(routineId: number) {
    super(`Routine ${routineId} is not archived and cannot be deleted`)
    this.routineId = routineId
  }
}

export class RoutineHasHistory extends DataLayerError {
  readonly kind = 'forbidden_transition' as const
  readonly routineId: number
  constructor(routineId: number) {
    super(`Routine ${routineId} has sessions and cannot be deleted`)
    this.routineId = routineId
  }
}

// Better-sqlite3's error shape — we read `code` off it to translate constraint
// violations into the tagged classes above.
export type MaybeSqliteError = Error & { code?: string }

export function isSqliteError(err: unknown, code: string): boolean {
  return err instanceof Error && (err as MaybeSqliteError).code === code
}
