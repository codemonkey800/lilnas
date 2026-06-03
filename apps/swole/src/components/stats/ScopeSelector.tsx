'use client'

import Button from '@mui/material/Button'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'

import type { RoutineRow } from 'src/db/types'
import {
  buildScopeChips,
  orderArchivedByRecency,
  shouldRenderScopeSelector,
  type StatsScope,
} from 'src/lib/stats'

import { ArchivedRoutinePicker } from './ArchivedRoutinePicker'
import { ScopeChip } from './ScopeChip'

type Props = {
  activeRoutines: RoutineRow[]
  archivedWithHistory: RoutineRow[]
  archivedLastTrained: Map<number, Date>
  scope: StatsScope
  now: Date
}

export function ScopeSelector({
  activeRoutines,
  archivedWithHistory,
  archivedLastTrained,
  scope,
  now,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')

  // Hooks must precede early return — computed here unconditionally.
  const chips = useMemo(
    () => buildScopeChips(activeRoutines, archivedWithHistory, scope),
    [activeRoutines, archivedWithHistory, scope],
  )

  const orderedArchived = useMemo(
    () => orderArchivedByRecency(archivedWithHistory, archivedLastTrained),
    [archivedWithHistory, archivedLastTrained],
  )

  if (
    !shouldRenderScopeSelector(
      activeRoutines.length,
      archivedWithHistory.length,
    )
  ) {
    return null
  }

  function handleSelect(href: string) {
    startTransition(() => {
      router.replace(href, { scroll: false })
    })
  }

  function openPicker() {
    setQuery('')
    setPickerOpen(true)
  }

  return (
    <>
      <div
        role="group"
        aria-label="Scope — select routine"
        className="flex flex-wrap items-center gap-2"
        style={{ opacity: isPending ? 0.6 : 1, transition: 'opacity 150ms' }}
      >
        {chips.map(chip => (
          <ScopeChip
            key={chip.key}
            chip={chip}
            onSelect={handleSelect}
            disabled={isPending}
          />
        ))}

        {archivedWithHistory.length > 0 && (
          <Button
            size="small"
            onClick={openPicker}
            disabled={isPending}
            className="!normal-case !text-neutral-400 hover:!text-neutral-200"
            sx={{ fontFamily: 'inherit', fontSize: '0.8125rem' }}
          >
            View archived ({archivedWithHistory.length})…
          </Button>
        )}
      </div>

      <ArchivedRoutinePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        orderedArchived={orderedArchived}
        archivedLastTrained={archivedLastTrained}
        now={now}
        disabled={isPending}
        query={query}
        onQueryChange={setQuery}
        onSelect={id => {
          setPickerOpen(false)
          handleSelect(`/stats?routine=${id}`)
        }}
      />
    </>
  )
}
