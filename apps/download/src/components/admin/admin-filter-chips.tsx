'use client'

import { useRouter } from 'next/navigation'
import type { JSX } from 'react'
import { useOptimistic, useTransition } from 'react'

import { Button } from 'src/components/ui/button'
import { AppliedFilterChip } from 'src/components/ui/filters'
import type { AdminFilters } from 'src/lib/admin-filters'
import {
  adminFilterChips,
  adminHref,
  EMPTY_ADMIN_FILTERS,
  hasAdminFilters,
} from 'src/lib/admin-filters'

/** `gallery.pug`'s Clear all beside the applied chips — a 27px ghost button. */
const CLEAR_ALL_INLINE = 'h-[27px] px-2.5 text-[12px]'

export type AdminFilterChipsProps = {
  filters: AdminFilters
}

/**
 * What is currently narrowing the history, and the only way to widen it again.
 *
 * ⚠️ There is no filter *panel* on this page, and that is deliberate rather
 * than unfinished: `admin-dashboard.pug` draws no controls above its table at
 * all, and the control this page actually needs — "show me one person's
 * history" — is already every requester cell and every leaderboard row, each of
 * which is a link into `?requester=`. A popover restating a choice you make by
 * clicking the thing you are looking at would be a second way to do one thing.
 * `?type=` and `?status=` are honoured for the same reason: a shared
 * `/admin?status=failed` link is worth more than a control nobody would open.
 *
 * ⚠️ The bridge between "the URL is the state" and "a control must respond the
 * instant it is pressed" is `useOptimistic`, not an effect. A chip whose
 * presence came straight from `props.filters` would visibly linger until the
 * server answered; syncing a local copy in a `useEffect` is a
 * `react-hooks/set-state-in-effect` error in this package, and the render-phase
 * equivalent is a `react-hooks/set-state-in-render` error. `useOptimistic` is
 * built for exactly this shape: it shows `next` for as long as the navigation
 * transition is pending and then hands back to the prop, with nothing to unwind
 * when the navigation is interrupted or the user presses Back.
 */
export function AdminFilterChips({
  filters,
}: AdminFilterChipsProps): JSX.Element | null {
  const router = useRouter()
  const [applied, setApplied] = useOptimistic(filters)
  const [, startTransition] = useTransition()

  function apply(next: AdminFilters): void {
    startTransition(() => {
      setApplied(next)
      // `scroll: false` — a filter change replaces the table in place, and
      // yanking the viewport to the top of a page the user is already at the
      // top of is only ever felt as a jolt when they are not.
      router.push(adminHref(next), { scroll: false })
    })
  }

  const chips = adminFilterChips(applied)

  if (chips.length === 0) {
    return null
  }

  return (
    <div
      aria-label="Active filters"
      className="mb-[14px] flex flex-wrap items-center gap-2 sm:gap-[9px]"
      role="group"
    >
      {chips.map(chip => (
        <AppliedFilterChip
          key={chip.key}
          label={chip.label}
          onRemove={() => apply(chip.next)}
          removeLabel={chip.removeLabel}
        />
      ))}
      {chips.length > 1 && hasAdminFilters(applied) ? (
        <Button
          className={CLEAR_ALL_INLINE}
          onClick={() => apply({ ...EMPTY_ADMIN_FILTERS, days: applied.days })}
          size="sm"
          variant="ghost"
        >
          Clear all
        </Button>
      ) : null}
    </div>
  )
}
