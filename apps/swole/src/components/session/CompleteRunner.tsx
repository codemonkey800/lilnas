'use client'

import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'

import { commitProgressionDecision } from 'src/actions/progressions'
import { completeSession } from 'src/actions/sessions'
import type { PostSessionPrompt } from 'src/core/session-machine'

type MappedPrompt = PostSessionPrompt & {
  exerciseId: number
  exerciseName: string
}

export type CompleteRunnerProps = {
  sessionId: number
  routineName: string
  prompts: MappedPrompt[]
  exerciseCount: number
  totalSetsLogged: number
}

export function CompleteRunner({
  sessionId,
  routineName,
  prompts,
  exerciseCount,
  totalSetsLogged,
}: CompleteRunnerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [cursorIdx, setCursorIdx] = useState(0)
  const processedRef = useRef(new Set<number>())

  const processPrompt = useCallback(
    (idx: number, chosenWeight: number) => {
      if (processedRef.current.has(idx)) return
      processedRef.current.add(idx)
      const prompt = prompts[idx]!
      startTransition(async () => {
        await commitProgressionDecision({
          sessionId,
          exerciseId: prompt.exerciseId,
          chosenStartingWeight: chosenWeight,
        })
        const next = idx + 1
        if (next >= prompts.length) {
          await completeSession({ sessionId })
          router.push(`/session/${sessionId}?finished=1`)
        } else {
          setCursorIdx(next)
        }
      })
    },
    [sessionId, prompts, router],
  )

  // All prompts are auto-committed; navigate to detail page immediately (no dwell
  // — the trophy accent on the detail page carries the celebration, per KD6).
  useEffect(() => {
    if (prompts.length === 0) {
      startTransition(async () => {
        await completeSession({ sessionId })
        router.push(`/session/${sessionId}?finished=1`)
      })
      return
    }
    const prompt = prompts[cursorIdx]
    if (prompt) {
      processPrompt(cursorIdx, prompt.newStartingWeight)
    }
  }, [cursorIdx, prompts, processPrompt, sessionId, router])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      {isPending ? (
        <>
          <CircularProgress className="!text-orange-400" />
          <Typography color="text.secondary">Saving session…</Typography>
        </>
      ) : (
        <>
          <EmojiEventsOutlinedIcon className="!text-6xl !text-orange-400" />
          <Typography component="h2" variant="h5" className="!font-bold">
            Session Complete
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {routineName}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'} ·{' '}
            {totalSetsLogged} {totalSetsLogged === 1 ? 'set' : 'sets'} logged
          </Typography>
        </>
      )}
    </div>
  )
}
