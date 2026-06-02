import Link from 'next/link'
import { redirect } from 'next/navigation'

import { updateRoutineWithExercises } from 'src/actions/routines'
import { RoutineForm } from 'src/components/routines/RoutineForm'
import { getRoutineWithExercises } from 'src/db/routines'
import { getActiveSessionForRoutine } from 'src/db/sessions'
import { toExerciseCardState } from 'src/lib/routine-form'

// Force dynamic so each visit re-queries SQLite; consistent with home page
// and session/[id]/page.tsx.
export const dynamic = 'force-dynamic'

export default async function EditRoutinePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const routineId = Number(id)

  if (!Number.isInteger(routineId) || routineId <= 0) {
    redirect('/')
  }

  const data = await getRoutineWithExercises({ id: routineId })
  if (!data || data.routine.archivedAt != null) {
    redirect('/')
  }

  const active = await getActiveSessionForRoutine(routineId)
  if (active) {
    return (
      <div className="flex flex-col gap-6 py-6">
        <div className="rounded-xl border border-yellow-700/50 bg-yellow-950/30 p-4">
          <p className="text-sm font-semibold text-yellow-300">
            Workout in progress
          </p>
          <p className="mt-1 text-sm text-neutral-300">
            Finish or abandon the active workout before editing this routine.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Link
            href={`/session/${active.id}`}
            className="flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Resume workout
          </Link>
          <Link
            href="/"
            className="flex w-full items-center justify-center rounded-lg border border-neutral-700 px-4 py-3 text-sm font-medium text-neutral-300 hover:border-neutral-500"
          >
            Back to home
          </Link>
        </div>
      </div>
    )
  }

  const initialValues = {
    name: data.routine.name,
    days: data.routine.days,
    cards: data.exercises.map(toExerciseCardState),
  }

  const boundAction = updateRoutineWithExercises.bind(null, routineId)

  return (
    <div className="py-6">
      <RoutineForm
        initialValues={initialValues}
        submitAction={boundAction}
        submitLabel="Save changes"
        mode="edit"
        guardUnsavedChanges
      />
    </div>
  )
}
