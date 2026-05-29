// Shared validation schema and pure form helpers for the routine builder.
// No 'use client' or 'server-only' — importable from both client components
// and server mutations. Import CreateExerciseArgs with `import type` to avoid
// dragging server-only db/exercises.ts into the client bundle.

import { z } from 'zod'

import type { CreateExerciseArgs } from 'src/db/exercises'
import { type DayCode, dayCodes } from 'src/db/schema'

// ─── Data shapes ─────────────────────────────────────────────────────────────

// Raw string state held by each controlled exercise card in the form.
// All numeric fields are strings to support controlled inputs.
// `duration` is shared: time-based interprets it as seconds, cardio as minutes.
export type ExerciseCardState = {
  id: string
  type: 'weighted' | 'bodyweight' | 'time-based' | 'cardio'
  name: string
  sets: string
  targetReps: string
  startingWeight: string
  increment: string
  duration: string
}

export type CardFieldErrors = Partial<
  Record<
    | 'name'
    | 'sets'
    | 'targetReps'
    | 'startingWeight'
    | 'increment'
    | 'duration',
    string
  >
>

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const positiveInt = z.number().int().min(1)

export const exerciseDraftSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('weighted'),
    name: z.string().trim().min(1),
    sets: positiveInt,
    targetReps: positiveInt,
    startingWeight: positiveInt,
    increment: positiveInt,
  }),
  z.object({
    type: z.literal('bodyweight'),
    name: z.string().trim().min(1),
    sets: positiveInt,
    targetReps: positiveInt,
  }),
  z.object({
    type: z.literal('time-based'),
    name: z.string().trim().min(1),
    sets: positiveInt,
    durationSeconds: positiveInt,
  }),
  z.object({
    type: z.literal('cardio'),
    name: z.string().trim().min(1),
    sets: z.literal(1),
    durationSeconds: positiveInt,
  }),
])

export const routineFormSchema = z.object({
  name: z.string().trim().min(1),
  days: z.array(z.enum(dayCodes)),
  exercises: z.array(exerciseDraftSchema).min(1),
})

export type ExerciseDraft = z.infer<typeof exerciseDraftSchema>
export type RoutineFormValues = z.infer<typeof routineFormSchema>

// ─── Card factory ────────────────────────────────────────────────────────────

export function createEmptyCard(): ExerciseCardState {
  return {
    id: crypto.randomUUID(),
    type: 'weighted',
    name: '',
    sets: '3',
    targetReps: '10',
    startingWeight: '',
    increment: '5',
    duration: '',
  }
}

// ─── Type-switch (R9 matrix) ─────────────────────────────────────────────────

// Preserves applicable fields and clears the rest when the user changes a
// card's type. Cleared values are set to '' (not hidden) so repeated switching
// never resurfaces stale data through the UI's type-conditional rendering.
// Name is intentionally cleared on every type switch because each type has its
// own catalog list — a name from the prior type's list must not carry over.
export function applyTypeSwitch(
  card: ExerciseCardState,
  newType: ExerciseCardState['type'],
): ExerciseCardState {
  const base = { id: card.id, type: newType, name: '' }
  switch (newType) {
    case 'weighted':
      return {
        ...base,
        sets: card.sets,
        targetReps: card.targetReps,
        startingWeight: '',
        increment: '5',
        duration: '',
      }
    case 'bodyweight':
      return {
        ...base,
        sets: card.sets,
        targetReps: card.targetReps,
        startingWeight: '',
        increment: '',
        duration: '',
      }
    case 'time-based':
      return {
        ...base,
        sets: card.sets,
        targetReps: '',
        startingWeight: '',
        increment: '',
        duration: card.duration,
      }
    case 'cardio':
      return {
        ...base,
        sets: '1',
        targetReps: '',
        startingWeight: '',
        increment: '',
        duration: card.duration,
      }
  }
}

// ─── Normalization and validation ─────────────────────────────────────────────

// Parses a numeric input string to an integer. Returns undefined for empty,
// non-numeric, or non-integer inputs so zod receives `undefined` (→ "required"
// error) rather than 0, keeping that error distinct from the ".min(1)" error
// for an explicitly-entered 0.
function parsePositiveInt(s: string): number | undefined {
  const trimmed = s.trim()
  if (trimmed === '') return undefined
  const n = Number(trimmed)
  if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined
  return n
}

// Maps a draft schema field name back to the card-state field name for error
// key mapping. durationSeconds lives in the draft but the UI calls it duration.
function draftFieldToCardField(field: string): string {
  return field === 'durationSeconds' ? 'duration' : field
}

export type NormalizeCardResult =
  | { ok: true; draft: ExerciseDraft }
  | { ok: false; errors: CardFieldErrors }

// Converts ExerciseCardState (raw strings) to ExerciseDraft (validated numbers)
// via zod. cardio duration is entered in minutes and converted to seconds here.
export function normalizeCard(card: ExerciseCardState): NormalizeCardResult {
  let draftInput: Record<string, unknown>

  switch (card.type) {
    case 'weighted':
      draftInput = {
        type: 'weighted',
        name: card.name,
        sets: parsePositiveInt(card.sets),
        targetReps: parsePositiveInt(card.targetReps),
        startingWeight: parsePositiveInt(card.startingWeight),
        increment: parsePositiveInt(card.increment),
      }
      break
    case 'bodyweight':
      draftInput = {
        type: 'bodyweight',
        name: card.name,
        sets: parsePositiveInt(card.sets),
        targetReps: parsePositiveInt(card.targetReps),
      }
      break
    case 'time-based':
      draftInput = {
        type: 'time-based',
        name: card.name,
        sets: parsePositiveInt(card.sets),
        durationSeconds: parsePositiveInt(card.duration),
      }
      break
    case 'cardio': {
      const mins = parsePositiveInt(card.duration)
      draftInput = {
        type: 'cardio',
        name: card.name,
        sets: 1,
        durationSeconds: mins !== undefined ? mins * 60 : undefined,
      }
      break
    }
  }

  const result = exerciseDraftSchema.safeParse(draftInput)

  if (result.success) {
    return { ok: true, draft: result.data }
  }

  const errors: CardFieldErrors = {}
  for (const issue of result.error.issues) {
    const field = issue.path[0]
    if (typeof field === 'string') {
      const key = draftFieldToCardField(field) as keyof CardFieldErrors
      if (!errors[key]) {
        errors[key] = issue.message
      }
    }
  }

  return { ok: false, errors }
}

// ─── Save gate (R12 / F2) ─────────────────────────────────────────────────────

export function isRoutineFormValid({
  name,
  cards,
}: {
  name: string
  cards: ExerciseCardState[]
}): boolean {
  return (
    name.trim().length > 0 &&
    cards.length >= 1 &&
    cards.every(c => normalizeCard(c).ok)
  )
}

// ─── Day canonicalizer (R6) ───────────────────────────────────────────────────

// Returns days sorted Mon-first by filtering dayCodes in schema order.
export function canonicalizeDays(selected: Set<DayCode>): DayCode[] {
  return dayCodes.filter(d => selected.has(d)) as DayCode[]
}

// ─── Draft → CreateExerciseArgs ───────────────────────────────────────────────

// Per-type switch to satisfy the discriminated union — TypeScript can't narrow
// through generic spread on a union type.
export function toCreateExerciseArgs(
  draft: ExerciseDraft,
  routineId: number,
  orderInRoutine: number,
): CreateExerciseArgs {
  switch (draft.type) {
    case 'weighted':
      return {
        routineId,
        orderInRoutine,
        type: 'weighted',
        name: draft.name,
        sets: draft.sets,
        targetReps: draft.targetReps,
        startingWeight: draft.startingWeight,
        increment: draft.increment,
      }
    case 'bodyweight':
      return {
        routineId,
        orderInRoutine,
        type: 'bodyweight',
        name: draft.name,
        sets: draft.sets,
        targetReps: draft.targetReps,
      }
    case 'time-based':
      return {
        routineId,
        orderInRoutine,
        type: 'time-based',
        name: draft.name,
        sets: draft.sets,
        durationSeconds: draft.durationSeconds,
      }
    case 'cardio':
      return {
        routineId,
        orderInRoutine,
        type: 'cardio',
        name: draft.name,
        sets: 1,
        durationSeconds: draft.durationSeconds,
      }
  }
}
