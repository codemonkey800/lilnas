'use server'

import { revalidatePath } from 'next/cache'

import {
  archiveExercise as dbArchiveExercise,
  type ArchiveExerciseArgs,
  createExercise as dbCreateExercise,
  type CreateExerciseArgs,
  reorderExercises as dbReorderExercises,
  type ReorderExercisesArgs,
  updateExercise as dbUpdateExercise,
  type UpdateExerciseArgs,
} from 'src/db/exercises'
import type { ExerciseRow } from 'src/db/types'

export async function createExercise(
  args: CreateExerciseArgs,
): Promise<ExerciseRow> {
  const row = await dbCreateExercise(args)
  revalidatePath(`/routines/${args.routineId}`)
  return row
}

export async function updateExercise(
  args: UpdateExerciseArgs,
): Promise<ExerciseRow> {
  const row = await dbUpdateExercise(args)
  revalidatePath(`/routines/${row.routineId}`)
  revalidatePath(`/stats/${args.id}`)
  return row
}

export async function archiveExercise(
  args: ArchiveExerciseArgs,
): Promise<ExerciseRow> {
  const row = await dbArchiveExercise(args)
  revalidatePath(`/routines/${row.routineId}`)
  return row
}

export async function reorderExercises(
  args: ReorderExercisesArgs,
): Promise<void> {
  await dbReorderExercises(args)
  revalidatePath(`/routines/${args.routineId}`)
}
