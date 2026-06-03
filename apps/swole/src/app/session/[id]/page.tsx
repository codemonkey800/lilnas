import { SessionNotActive } from 'src/components/session/SessionNotActive'
import { SessionRunner } from 'src/components/session/SessionRunner'
import { buildSessionState } from 'src/db/hydration'
import { getRoutine } from 'src/db/routines'

// Force dynamic so each visit re-queries SQLite; consistent with home page.
export const dynamic = 'force-dynamic'

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const sessionId = Number(id)

  // Guard non-integer ids (e.g. /session/abc).
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return <SessionNotActive />
  }

  const hydrated = await buildSessionState({ sessionId })
  if (!hydrated) {
    // R2: null covers both unknown and completed sessions — one neutral message.
    return <SessionNotActive />
  }

  // Routine name lives on the RoutineRow; RoutineWithIds has no name field.
  const routineRow = await getRoutine({ id: hydrated.session.routineId })

  return (
    <SessionRunner
      session={hydrated.session}
      routine={hydrated.routine}
      routineName={routineRow?.name ?? '…'}
      sessionState={hydrated.sessionState}
      failedSetLogIds={hydrated.failedSetLogIds}
    />
  )
}
