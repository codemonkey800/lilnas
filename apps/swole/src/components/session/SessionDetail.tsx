import { cns } from '@lilnas/utils/cns'
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

import type { CompletedHydratedSession } from 'src/db/hydration'
import { toExercise } from 'src/db/mappers'
import {
  formatExerciseConfig,
  formatJournalSessionDate,
  formatRelativeDay,
  formatSessionDuration,
  formatSetRow,
  formatWeight,
} from 'src/lib/format'
import { groupSetLogsByExercise, weightedVolume } from 'src/lib/stats'

import { SessionDetailActions } from './SessionDetailActions'

type Props = {
  bundle: CompletedHydratedSession
  routineName: string
  showAccent: boolean
}

export function SessionDetail({ bundle, routineName, showAccent }: Props) {
  const { session, exercises, setLogs, progressions, failedSetLogIds } = bundle
  const now = new Date()

  const groups = groupSetLogsByExercise(setLogs, exercises)
  const exerciseCount = groups.length
  const setCount = setLogs.length
  const volume = weightedVolume(setLogs)

  return (
    <div className="flex flex-col gap-6 px-4 pb-10 pt-4">
      {/* Back affordance */}
      <Button href="/" variant="text" size="small" className="!self-start">
        ← Home
      </Button>

      {/* Header */}
      <div className="flex flex-col gap-1">
        {showAccent && (
          <div className="flex items-center gap-1.5 text-orange-400">
            <EmojiEventsOutlinedIcon className="!text-xl !text-orange-400" />
            <span className="text-sm font-medium">Session complete</span>
          </div>
        )}

        <Typography
          component="h1"
          variant="h5"
          className="!font-bold !leading-tight"
        >
          {routineName}
        </Typography>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-neutral-400">
          <span>{formatJournalSessionDate(session.completedAt)}</span>
          <span className="text-neutral-600">·</span>
          <span>{formatRelativeDay(session.completedAt, now)}</span>
          <span className="text-neutral-600">·</span>
          <span>
            {formatSessionDuration(session.startedAt, session.completedAt)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-neutral-500">
          <span>
            {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}
          </span>
          <span className="text-neutral-700">·</span>
          <span>
            {setCount} {setCount === 1 ? 'set' : 'sets'}
          </span>
          {volume > 0 && (
            <>
              <span className="text-neutral-700">·</span>
              <span>{formatWeight(volume)} volume</span>
            </>
          )}
        </div>
      </div>

      {/* Degraded notice */}
      {failedSetLogIds.length > 0 && (
        <div
          className={cns(
            'rounded-xl border border-yellow-900/50 bg-yellow-950/30',
            'px-4 py-3 text-sm text-yellow-400',
          )}
        >
          Some sets from this session couldn&apos;t be loaded and aren&apos;t
          shown.
        </div>
      )}

      {/* Body */}
      {setLogs.length === 0 ? (
        <p className="py-6 text-center text-sm text-neutral-500">
          No sets logged this session.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(({ exercise, logs }) => {
            const exerciseConfig = formatExerciseConfig(toExercise(exercise))

            return (
              <div key={exercise.id} className="flex flex-col gap-1.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-neutral-200">
                    {exercise.name}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {exerciseConfig}
                  </span>
                </div>
                <ul
                  className={cns(
                    'flex flex-col divide-y divide-neutral-900',
                    'overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/40',
                  )}
                >
                  {logs.map(setLog => {
                    const parts = formatSetRow(setLog, exercise)
                    return (
                      <li
                        key={setLog.id}
                        className="px-4 py-2.5 text-sm text-neutral-200"
                      >
                        {parts.kind === 'shortfall' ? (
                          <>
                            {parts.pre}
                            <span className="text-orange-400">
                              {parts.fraction}
                            </span>
                            {parts.post}
                          </>
                        ) : (
                          parts.text
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      {/* Delete affordance */}
      <SessionDetailActions
        sessionId={session.id}
        progressions={progressions}
      />
    </div>
  )
}
