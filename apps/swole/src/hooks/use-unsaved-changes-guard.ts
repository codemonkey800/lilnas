'use client'

import { useEffect, useRef } from 'react'

import type { DayCode } from 'src/db/schema'
import { canonicalizeDays, type ExerciseCardState } from 'src/lib/routine-form'

// ─── Pure dirty-check ────────────────────────────────────────────────────────

type FormSnapshot = {
  name: string
  days: DayCode[]
  cards: ExerciseCardState[]
}

// Captures the form's "clean" state as a snapshot for dirty comparison.
// Call once on mount with initialValues.
export function buildFormSnapshot(
  name: string,
  days: DayCode[],
  cards: ExerciseCardState[],
): FormSnapshot {
  return {
    name: name.trim(),
    days: canonicalizeDays(new Set(days)),
    cards,
  }
}

// Returns true when the current form state differs from the mount snapshot.
// Includes name, days order, card list length, and per-card fields + dbId + order.
export function isFormDirty(
  snapshot: FormSnapshot,
  current: { name: string; days: DayCode[]; cards: ExerciseCardState[] },
): boolean {
  if (current.name.trim() !== snapshot.name) return true

  const currentDays = canonicalizeDays(new Set(current.days))
  if (JSON.stringify(currentDays) !== JSON.stringify(snapshot.days)) return true

  if (current.cards.length !== snapshot.cards.length) return true

  for (let i = 0; i < current.cards.length; i++) {
    const c = current.cards[i]!
    const s = snapshot.cards[i]!
    if (
      c.dbId !== s.dbId ||
      c.type !== s.type ||
      c.name !== s.name ||
      c.sets !== s.sets ||
      c.targetReps !== s.targetReps ||
      c.startingWeight !== s.startingWeight ||
      c.increment !== s.increment ||
      c.duration !== s.duration
    ) {
      return true
    }
  }

  return false
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

type UseUnsavedChangesGuardOptions = {
  isDirty: boolean
  enabled: boolean
}

// Registers a beforeunload handler while enabled and dirty, using a ref to
// avoid React 19 Strict-Mode stale-closure issues.
export function useUnsavedChangesGuard({
  isDirty,
  enabled,
}: UseUnsavedChangesGuardOptions): void {
  const isDirtyRef = useRef(isDirty)
  const enabledRef = useRef(enabled)

  useEffect(() => {
    isDirtyRef.current = isDirty
  })
  useEffect(() => {
    enabledRef.current = enabled
  })

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (enabledRef.current && isDirtyRef.current) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])
}
