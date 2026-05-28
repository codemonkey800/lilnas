'use server'

// Next.js-aware wrappers around the pure DB mutations. These are the entry
// points UI server-actions and route handlers should import — never call
// `db/routines.ts` directly from a request scope, since the cache-revalidate
// side effects live here, not in the data layer (#25).

import { revalidatePath } from 'next/cache'

import {
  archiveRoutine as dbArchiveRoutine,
  type ArchiveRoutineArgs,
  createRoutine as dbCreateRoutine,
  type CreateRoutineArgs,
  updateRoutine as dbUpdateRoutine,
  type UpdateRoutineArgs,
} from 'src/db/routines'
import type { RoutineRow } from 'src/db/types'

export async function createRoutine(
  args: CreateRoutineArgs,
): Promise<RoutineRow> {
  const row = await dbCreateRoutine(args)
  revalidatePath('/')
  return row
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
): Promise<RoutineRow> {
  const row = await dbArchiveRoutine(args)
  revalidatePath('/')
  revalidatePath(`/routines/${args.id}`)
  return row
}
