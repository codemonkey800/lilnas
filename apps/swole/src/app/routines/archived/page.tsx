import Typography from '@mui/material/Typography'
import Link from 'next/link'

import { ArchivedRoutineRow } from 'src/components/routines/ArchivedRoutineRow'
import { listArchivedRoutinesForManagement } from 'src/db/routines'
import { orderArchivedByRecency } from 'src/lib/stats'

export const dynamic = 'force-dynamic'

export default async function ArchivedRoutinesPage() {
  const now = new Date()
  const summaries = await listArchivedRoutinesForManagement()

  const lastTrainedMap = new Map(
    summaries
      .filter(s => s.lastTrained !== null)
      .map(s => [s.routine.id, s.lastTrained as Date]),
  )
  const summaryById = new Map(summaries.map(s => [s.routine.id, s]))
  const orderedRoutines = orderArchivedByRecency(
    summaries.map(s => s.routine),
    lastTrainedMap,
  )
  const orderedSummaries = orderedRoutines.map(r => summaryById.get(r.id)!)

  return (
    <div className="flex flex-col gap-6 py-6">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="text-sm text-[var(--mui-palette-text-secondary)] hover:underline"
        >
          ← Home
        </Link>
      </div>

      <Typography component="h1" variant="h5" className="!font-bold">
        Archived routines
      </Typography>

      {orderedSummaries.length === 0 ? (
        <Typography
          variant="body2"
          color="text.secondary"
          className="py-8 text-center"
        >
          No archived routines
        </Typography>
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-800 rounded-xl border border-neutral-800">
          {orderedSummaries.map(s => (
            <li key={s.routine.id}>
              <ArchivedRoutineRow summary={s} now={now} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
