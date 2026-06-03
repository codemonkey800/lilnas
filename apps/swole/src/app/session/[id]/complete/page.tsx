import { redirect } from 'next/navigation'

import { CompleteRunner } from 'src/components/session/CompleteRunner'
import { classifyPostSession } from 'src/core/session-machine'
import { buildSessionState } from 'src/db/hydration'
import { getRoutine } from 'src/db/routines'

export const dynamic = 'force-dynamic'

export default async function CompletePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const sessionId = Number(id)

  if (!Number.isInteger(sessionId) || sessionId <= 0) redirect('/')

  const hydrated = await buildSessionState({ sessionId })
  if (!hydrated) redirect('/')

  const routineRow = await getRoutine({ id: hydrated.session.routineId })
  const prompts = classifyPostSession(hydrated.sessionState, hydrated.routine)

  const mappedPrompts = prompts.map(p => ({
    ...p,
    exerciseId: hydrated.routine.exercises[p.exerciseIdx]!.id,
    exerciseName: hydrated.routine.exercises[p.exerciseIdx]!.name,
  }))

  return (
    <CompleteRunner
      sessionId={sessionId}
      routineName={routineRow?.name ?? '…'}
      prompts={mappedPrompts}
      exerciseCount={hydrated.routine.exercises.length}
      totalSetsLogged={hydrated.sessionState.setLogs.length}
    />
  )
}
