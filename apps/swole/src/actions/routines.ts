'use server'

// Next.js-aware wrappers around the pure DB mutations. These are the entry
// points UI server-actions and route handlers should import — never call
// `db/routines.ts` directly from a request scope, since the cache-revalidate
// side effects live here, not in the data layer (#25).

import { revalidatePath } from 'next/cache'

import {
  DataLayerError,
} from 'src/db/errors'
import {
  archiveRoutine as dbArchiveRoutine,
  type ArchiveRoutineArgs,
  createRoutine as dbCreateRoutine,
  type CreateRoutineArgs,
  createRoutineWithExercises as dbCreateRoutineWithExercises,
  updateRoutine as dbUpdateRoutine,
  type UpdateRoutineArgs,
} from 'src/db/routines'
import type { RoutineRow } from 'src/db/types'
import type { RoutineFormValues } from 'src/lib/routine-form'
import type { ActionResult } from 'src/actions/sessions'

export async function createRoutine(
  args: CreateRoutineArgs,
): Promise<RoutineRow> {
  const row = await dbCreateRoutine(args)
  revalidatePath('/')
  return row
}

export async function createRoutineWithExercises(
  args: RoutineFormValues,
): Promise<ActionResult<RoutineRow>> {
  try {
    const row = await dbCreateRoutineWithExercises(args)
    revalidatePath('/')
    return { ok: true, row }
  } catch (err) {
    if (err instanceof DataLayerError)
      return { ok: false, kind: err.kind, code: err.constructor.name }
    throw err
  }
}

export async function updateRoutine(
  args: UpdateRoutineArgs,
): Promise<RoutineRow> {
  const row = await dbUpdateRoutine(args)
  revalidatePath('/')
  revalidatePath(`/routines/${args.id}`)
  return row
}

export async function archiveRoutine(
  args: ArchiveRoutineArgs,
): Promise<ActionResult<RoutineRow>> {
  try {
    const row = await dbArchiveRoutine(args)
    revalidatePath('/')
    revalidatePath(`/routines/${args.id}`)
    return { ok: true, row }
  } catch (err) {
    if (err instanceof DataLayerError)
      return { ok: false, kind: err.kind, code: err.constructor.name }
    throw err
  }
}
