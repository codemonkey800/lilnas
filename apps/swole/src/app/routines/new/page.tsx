import { createRoutineWithExercises } from 'src/actions/routines'
import { RoutineForm } from 'src/components/routines/RoutineForm'
import { createEmptyCard } from 'src/lib/routine-form'

export default function NewRoutinePage() {
  return (
    <div className="py-6">
      <RoutineForm
        initialValues={{ name: '', days: [], cards: [createEmptyCard()] }}
        submitAction={createRoutineWithExercises}
      />
    </div>
  )
}
