import { SessionDetail } from 'src/components/session/SessionDetail'
import { SessionNotActive } from 'src/components/session/SessionNotActive'
import { SessionRunner } from 'src/components/session/SessionRunner'
import { buildCompletedSessionState, buildSessionState } from 'src/db/hydration'
import { getRoutine } from 'src/db/routines'
import { getSession } from 'src/db/sessions'
import { classifySessionView } from 'src/lib/session-detail'

// Force dynamic so each visit re-queries SQLite; consistent with home page.
export const dynamic = 'force-dynamic'

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ finished?: string }>
}) {
  const { id } = await params
  const sessionId = Number(id)

  // Guard non-integer ids (e.g. /session/abc).
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return <SessionNotActive />
  }

  const session = await getSession({ id: sessionId })

  switch (classifySessionView(session)) {
    case 'unknown':
      return <SessionNotActive />

    case 'active': {
      const hydrated = await buildSessionState({ sessionId })
      if (!hydrated) return <SessionNotActive />
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

    case 'completed': {
      const completed = await buildCompletedSessionState({ sessionId })
      if (!completed) return <SessionNotActive />
      const { finished } = await searchParams
      return (
        <SessionDetail
          bundle={completed}
          routineName={completed.routine.name}
          showAccent={finished === '1'}
        />
      )
    }
  }
}
