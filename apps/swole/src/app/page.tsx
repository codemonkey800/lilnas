import Button from '@mui/material/Button'
import Link from 'next/link'

import { EmptyState } from 'src/components/home/EmptyState'
import { RecentSessionsStrip } from 'src/components/home/RecentSessionsStrip'
import { ResumeBanner } from 'src/components/home/ResumeBanner'
import { RoutineCard } from 'src/components/home/RoutineCard'
import type { Exercise, NextTarget } from 'src/core/session-machine'
import { nextTarget } from 'src/core/session-machine'
import { buildSessionState } from 'src/db/hydration'
import { toExercise } from 'src/db/mappers'
import {
  countArchivedRoutines,
  getRoutine,
  listRoutinesForHome,
} from 'src/db/routines'
import {
  getMostRecentActiveSession,
  listRecentCompletedSessions,
} from 'src/db/sessions'
import { getCurrentDayCode } from 'src/lib/format'
import { logger } from 'src/lib/logger'

function ArchivedRoutinesLink({ count }: { count: number }) {
  return (
    <Link
      href="/routines/archived"
      className="text-center text-sm text-[var(--mui-palette-text-secondary)] underline-offset-2 hover:underline"
    >
      Archived routines ({count})
    </Link>
  )
}

// Force dynamic so each visit re-queries SQLite. Existing actions call
// `revalidatePath('/')` already; `force-dynamic` is the belt-and-suspenders
// that matches portal's precedent and avoids freezing the first snapshot
// at build time.
export const dynamic = 'force-dynamic'

type BannerData = {
  sessionId: number
  routineName: string
  target: NextTarget | null
  exercise: Exercise | null
  degraded: boolean
}

async function deriveBannerData(
  activeSessionId: number,
  activeRoutineId: number,
): Promise<BannerData | null> {
  const hydrated = await buildSessionState({ sessionId: activeSessionId })
  if (!hydrated) return null

  // The active session's routine may be archived (defensive case). Use
  // `getRoutine` directly so the banner always renders the real name —
  // `listRoutinesForHome` filters archived rows.
  const routineRow = await getRoutine({ id: activeRoutineId })
  if (!routineRow) return null

  const target = nextTarget(hydrated.sessionState, hydrated.routine)
  const exercise = target
    ? (hydrated.routine.exercises[target.exerciseIdx] as Exercise)
    : null
  const degraded = hydrated.failedSetLogIds.length > 0
  if (degraded) {
    logger.warn({
      msg: 'swole home: hydrated session has skipped set logs',
      sessionId: activeSessionId,
      failedSetLogIds: hydrated.failedSetLogIds,
    })
  }

  return {
    sessionId: activeSessionId,
    routineName: routineRow.name,
    target,
    exercise,
    degraded,
  }
}

export default async function RootPage() {
  const now = new Date()
  const todayCode = getCurrentDayCode(now)

  const [routinesRaw, activeSession, completedSessions, archivedCount] =
    await Promise.all([
      listRoutinesForHome(),
      getMostRecentActiveSession(),
      listRecentCompletedSessions({ limit: 5 }),
      countArchivedRoutines(),
    ])

  // Today's routines first, then the rest (both groups already alphabetical from DB)
  const routines = todayCode
    ? [
        ...routinesRaw.filter(({ routine }) =>
          routine.days.includes(todayCode),
        ),
        ...routinesRaw.filter(
          ({ routine }) => !routine.days.includes(todayCode),
        ),
      ]
    : routinesRaw

  const banner = activeSession
    ? await deriveBannerData(activeSession.id, activeSession.routineId)
    : null

  if (routines.length === 0 && !banner) {
    return <EmptyState archivedCount={archivedCount} />
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      {banner && (
        <ResumeBanner
          sessionId={banner.sessionId}
          routineName={banner.routineName}
          target={banner.target}
          exercise={banner.exercise}
          degraded={banner.degraded}
        />
      )}

      {routines.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {routines.map(({ routine, exerciseCount, firstExercise }) => (
              <RoutineCard
                key={routine.id}
                routine={routine}
                exerciseCount={exerciseCount}
                firstExercise={firstExercise ? toExercise(firstExercise) : null}
                todayCode={todayCode}
              />
            ))}
          </div>
          <Button
            href="/routines/new"
            variant="outlined"
            fullWidth
            className="!border-dashed !border-neutral-700 !py-3 !text-neutral-400 hover:!border-neutral-500 hover:!text-neutral-300"
          >
            + New Routine
          </Button>
          {archivedCount > 0 && <ArchivedRoutinesLink count={archivedCount} />}
        </div>
      )}

      {completedSessions.length > 0 && (
        <RecentSessionsStrip rows={completedSessions} now={now} />
      )}
    </div>
  )
}
