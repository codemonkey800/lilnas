'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useOptimistic, useState, useTransition } from 'react'

import { appendSetLog, undoLastSetLog } from 'src/actions/setLogs'
import { CurrentSetCard } from 'src/components/session/CurrentSetCard'
import { DegradedStrip } from 'src/components/session/DegradedStrip'
import { ExercisesDrawer } from 'src/components/session/ExercisesDrawer'
import { FailedSheet } from 'src/components/session/FailedSheet'
import { ReviewCard } from 'src/components/session/ReviewCard'
import { TerminalCard } from 'src/components/session/TerminalCard'
import { TopBar } from 'src/components/session/TopBar'
import type { Action, SessionState } from 'src/core/session-machine'
import { applyAction, nextTarget } from 'src/core/session-machine'
import type { RoutineWithIds } from 'src/db/mappers'
import { toSetLogArgs } from 'src/db/mappers'
import type { SessionRow } from 'src/db/types'
import { useToast } from 'src/hooks/use-toast'
import { mapSetLogError, mapUndoError } from 'src/lib/format'
import {
  deriveButtonConfig,
  deriveExerciseList,
  derivePreviousSetPeek,
  deriveProgress,
  deriveSessionSummary,
  resolveActiveOverride,
  type RunnerMsg,
} from 'src/lib/runner'
import { runnerReducer } from 'src/lib/runner'

export type SessionRunnerProps = {
  session: SessionRow
  routine: RoutineWithIds
  routineName: string
  sessionState: SessionState
  failedSetLogIds: number[]
}

export function SessionRunner({
  session,
  routine,
  routineName,
  sessionState,
  failedSetLogIds,
}: SessionRunnerProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [isPending, startTransition] = useTransition()

  // Optimistic setLogs — reverts automatically on throw (React 19 useOptimistic).
  const [optimistic, addOptimistic] = useOptimistic(
    sessionState,
    (s: SessionState, msg: RunnerMsg) => runnerReducer(s, msg, routine),
  )

  // Client-only transient state (R4) — never hydrated, never in useOptimistic.
  const [cursorOverride, setCursorOverride] = useState<number | undefined>(
    undefined,
  )
  const [reviewExerciseIdx, setReviewExerciseIdx] = useState<number | null>(
    null,
  )
  const [halted, setHalted] = useState(false)
  const [dismissedDegraded, setDismissedDegraded] = useState(false)
  const [failedSheetOpen, setFailedSheetOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Stale-override guard: a cursorOverride pointing at a full exercise is
  // treated as no override (prevents a phantom "Set N+1 of N" card).
  const activeOverride = resolveActiveOverride(
    optimistic.setLogs,
    cursorOverride,
    routine,
  )

  const effectiveState: SessionState = {
    setLogs: optimistic.setLogs,
    cursorOverride: activeOverride,
  }

  const target = nextTarget(effectiveState, routine)
  const activeExercise = target
    ? routine.exercises[target.exerciseIdx]
    : undefined
  const progress = deriveProgress(effectiveState, routine)
  const exerciseList = deriveExerciseList(effectiveState, routine)

  // ─── Action dispatch ──────────────────────────────────────────────────────

  const onAction = useCallback(
    (action: Action) => {
      if (isPending || halted) return

      const override = resolveActiveOverride(
        optimistic.setLogs,
        cursorOverride,
        routine,
      )
      const effState: SessionState = {
        setLogs: optimistic.setLogs,
        cursorOverride: override,
      }

      const next = applyAction(effState, action, routine)
      const newLog = next.setLogs[next.setLogs.length - 1]!
      const args = toSetLogArgs(newLog, session.id, routine)

      startTransition(async () => {
        addOptimistic({ kind: 'action', action, cursorOverride: override })
        const result = await appendSetLog(args)
        if (result.ok) {
          setCursorOverride(undefined) // R15 — clear jump only on success
        } else {
          const { kind, toast } = mapSetLogError(result)
          showToast(toast.message, toast.severity)
          if (kind === 'rehydrate') {
            setCursorOverride(undefined)
            setReviewExerciseIdx(null)
            router.refresh()
          } else if (kind === 'halt') {
            setHalted(true)
            router.push('/')
          }
          // 'rollback': optimistic auto-reverts when transition ends
        }
      })
    },
    [
      isPending,
      halted,
      cursorOverride,
      optimistic.setLogs,
      routine,
      session.id,
      startTransition,
      addOptimistic,
      showToast,
      router,
    ],
  )

  const onFailedConfirm = useCallback(
    (value: number) => {
      setFailedSheetOpen(false)
      if (!activeExercise) return
      const action: Action =
        activeExercise.type === 'time-based'
          ? { type: 'Failed', actualDuration: value }
          : { type: 'Failed', actualReps: value }
      onAction(action)
    },
    [activeExercise, onAction],
  )

  const onUndo = useCallback(() => {
    if (isPending || halted) return
    startTransition(async () => {
      setCursorOverride(undefined) // R17 — undo steps back across exercise boundaries
      addOptimistic({ kind: 'undo' })
      const result = await undoLastSetLog({ sessionId: session.id })
      if (!result.ok) {
        const { kind, toast } = mapUndoError(result)
        showToast(toast.message, toast.severity)
        if (kind === 'halt') {
          setHalted(true)
          router.push('/')
        }
        // 'rollback': optimistic auto-reverts when transition ends
      }
    })
  }, [
    isPending,
    halted,
    session.id,
    startTransition,
    addOptimistic,
    showToast,
    router,
  ])

  const onJump = useCallback((idx: number) => {
    setCursorOverride(idx)
    setDrawerOpen(false)
  }, [])

  const onReview = useCallback((idx: number) => {
    setReviewExerciseIdx(idx)
    setDrawerOpen(false)
  }, [])

  const onBack = useCallback(() => setReviewExerciseIdx(null), [])
  const onExit = useCallback(() => router.push('/'), [router])
  const onFinish = useCallback(
    () => router.push(`/session/${session.id}/complete`),
    [router, session.id],
  )

  // ─── Derived button config ────────────────────────────────────────────────

  const buttons =
    target && activeExercise
      ? deriveButtonConfig(
          activeExercise,
          target.setIdx === activeExercise.sets - 1,
          target,
        )
      : []

  const peek =
    target && activeExercise
      ? derivePreviousSetPeek(effectiveState, routine, target.exerciseIdx)
      : { kind: 'none' as const }

  const canUndo = optimistic.setLogs.length > 0 && !isPending

  // ─── Failed sheet mode ────────────────────────────────────────────────────

  const failedMode = activeExercise?.type === 'time-based' ? 'seconds' : 'reps'

  const failedDefault =
    activeExercise?.type === 'time-based'
      ? (activeExercise.durationSeconds ?? 30)
      : activeExercise && 'targetReps' in activeExercise
        ? activeExercise.targetReps
        : 10

  // ─── Review set logs ──────────────────────────────────────────────────────

  const reviewExercise =
    reviewExerciseIdx != null ? routine.exercises[reviewExerciseIdx] : undefined

  const reviewLogs =
    reviewExerciseIdx != null
      ? effectiveState.setLogs.filter(l => l.exerciseIdx === reviewExerciseIdx)
      : []

  // ─── Card-area mode ───────────────────────────────────────────────────────
  // reviewExerciseIdx → ReviewCard
  // target === null   → TerminalCard
  // else              → CurrentSetCard

  return (
    <div className="flex min-h-screen flex-col gap-4 px-4 py-4">
      <TopBar
        routineName={routineName}
        progress={progress}
        canUndo={canUndo}
        onUndo={onUndo}
        onOpenDrawer={() => setDrawerOpen(true)}
        onExit={onExit}
      />

      {failedSetLogIds.length > 0 && !dismissedDegraded && (
        <DegradedStrip onDismiss={() => setDismissedDegraded(true)} />
      )}

      <div className="flex flex-1 flex-col gap-4">
        {reviewExercise && reviewExerciseIdx != null ? (
          <ReviewCard
            exercise={reviewExercise}
            loggedSets={reviewLogs}
            onBack={onBack}
          />
        ) : target === null ? (
          <TerminalCard
            summary={deriveSessionSummary(effectiveState, routine)}
            onFinish={onFinish}
          />
        ) : (
          activeExercise && (
            <CurrentSetCard
              exercise={activeExercise}
              target={target}
              peek={peek}
              buttons={buttons}
              isPending={isPending}
              onAction={onAction}
              onOpenFailed={() => setFailedSheetOpen(true)}
            />
          )
        )}
      </div>

      <FailedSheet
        open={failedSheetOpen}
        mode={failedMode}
        defaultValue={failedDefault}
        isPending={isPending}
        onConfirm={onFailedConfirm}
        onCancel={() => setFailedSheetOpen(false)}
      />

      <ExercisesDrawer
        open={drawerOpen}
        exercises={exerciseList}
        onJump={onJump}
        onReview={onReview}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  )
}
