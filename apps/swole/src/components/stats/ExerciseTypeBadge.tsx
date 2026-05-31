import type { ExerciseRow } from 'src/db/types'

type Props = {
  type: ExerciseRow['type']
}

const TYPE_LABELS: Record<ExerciseRow['type'], string> = {
  weighted: 'Weighted',
  bodyweight: 'Bodyweight',
  'time-based': 'Time-based',
  cardio: 'Cardio',
}

export function ExerciseTypeBadge({ type }: Props) {
  return (
    <span className="rounded-md bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-300">
      {TYPE_LABELS[type]}
    </span>
  )
}
