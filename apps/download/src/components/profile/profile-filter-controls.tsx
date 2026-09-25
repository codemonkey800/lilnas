'use client'

import { cns } from '@lilnas/utils/cns'
import type { ProfileResponse } from '@lilnas/utils/download/types'
import { useRouter } from 'next/navigation'
import type { JSX, ReactNode } from 'react'
import {
  createContext,
  useContext,
  useMemo,
  useOptimistic,
  useTransition,
} from 'react'

import { PROFILE_GROUP_LABEL } from 'src/components/profile/profile-page-shell'
import { Button } from 'src/components/ui/button'
import { Chip } from 'src/components/ui/chip'
import { AppliedFilterChip } from 'src/components/ui/filters'
import { UNKNOWN_VALUE } from 'src/lib/format'
import type { ProfileFilters } from 'src/lib/profile-filters'
import {
  clearProfileFilters,
  hasProfileFilters,
  profileFilterChips,
  profileHref,
} from 'src/lib/profile-filters'
import type { ProfileTotalChip } from 'src/lib/profile-totals'
import { profileStatusChips, profileTypeChips } from 'src/lib/profile-totals'

/** `profile.pug`'s Clear all beside the applied chips — a 27px ghost button. */
const CLEAR_ALL_INLINE = 'h-[27px] px-2.5 text-[12px]'

type ProfileFilterState = {
  /** The filter as it should look *right now*, including an unlanded press. */
  applied: ProfileFilters
  /** Pushes a new address and shows it immediately. */
  apply: (next: ProfileFilters) => void
}

const ProfileFilterContext = createContext<ProfileFilterState | undefined>(
  undefined,
)

export type ProfileFilterProviderProps = {
  /**
   * Everything between the aggregate chips and the history table — the trend,
   * and the history heading. Both are server-rendered and pass straight
   * through; they sit inside this provider only because the two controls it
   * feeds are on either side of them in the layout.
   */
  children: ReactNode
  /** The filter the URL currently describes. */
  filters: ProfileFilters
}

/**
 * The one piece of client state on `/profile`: which chips are pressed.
 *
 * All of it is a projection of the URL. Pressing a chip pushes a new query
 * string at the router and the page re-renders from whatever comes back, so a
 * filtered profile is a link and the back button steps through filter changes.
 * There is no second copy of the filter to drift.
 *
 * ⚠️ The bridge between "the URL is the state" and "a chip must respond the
 * instant it is pressed" is `useOptimistic`, not an effect. A chip whose
 * `active` came straight from `props.filters` would visibly stay unpressed
 * until the server answered; syncing a local copy in a `useEffect` is a
 * `react-hooks/set-state-in-effect` error in this package, and the render-phase
 * equivalent is a `react-hooks/set-state-in-render` error. `useOptimistic` shows
 * `next` for as long as the navigation transition is pending and then hands back
 * to the prop, with nothing to unwind when the user presses Back.
 *
 * ⚠️ A context rather than one component wrapping the whole region, because the
 * two controls are **not** adjacent: the aggregate chips sit above the trend and
 * the applied-filter row sits below the history heading, and they have to agree
 * about the same optimistic value. Two independent `useOptimistic`s would let
 * the row below lag a press made above by a whole round trip.
 */
export function ProfileFilterProvider({
  children,
  filters,
}: ProfileFilterProviderProps): JSX.Element {
  const router = useRouter()
  const [applied, setApplied] = useOptimistic(filters)
  const [, startTransition] = useTransition()

  const value = useMemo<ProfileFilterState>(
    () => ({
      applied,
      apply(next) {
        startTransition(() => {
          setApplied(next)
          // `scroll: false` — a chip press replaces the table in place, and
          // yanking the viewport back to the top of the profile would throw
          // away the reading position the press was made from.
          router.push(profileHref(next), { scroll: false })
        })
      },
    }),
    [applied, router, setApplied, startTransition],
  )

  return (
    <ProfileFilterContext.Provider value={value}>
      {children}
    </ProfileFilterContext.Provider>
  )
}

/**
 * The filter state, for the two controls inside the provider.
 *
 * Throws rather than falling back to an unfiltered default: a chip rendered
 * outside the provider would look like it worked and quietly do nothing.
 */
function useProfileFilterState(): ProfileFilterState {
  const state = useContext(ProfileFilterContext)

  if (!state) {
    throw new Error(
      'Profile filter controls must be rendered inside <ProfileFilterProvider>',
    )
  }

  return state
}

export type ProfileTotalsProps = {
  /** `ProfileResponse.totalsByStatus`, sparse, exactly as it arrived. */
  totalsByStatus: ProfileResponse['totalsByStatus']
  /** `ProfileResponse.totalsByType`, sparse, exactly as it arrived. */
  totalsByType: ProfileResponse['totalsByType']
}

/**
 * Lifetime totals by type and by status — and the filter for the history below.
 *
 * ⚠️ Every count here is a **lifetime** total and stays put when a chip is
 * pressed. The aggregates are the vocabulary of what this person has ever
 * downloaded; recomputing them against the filtered view would mean pressing
 * `movie · 9` turned it into `movie · 9` of 9 and then `completed · 46` into
 * `completed · 4`, with no way to read what you had narrowed *from*.
 *
 * ⚠️ Sparse in, sparse out: a type or status that never occurred renders no chip
 * at all, and a group with nothing in it renders an em dash rather than an empty
 * row. Zero chips would be filters guaranteed to match nothing.
 */
export function ProfileTotals({
  totalsByStatus,
  totalsByType,
}: ProfileTotalsProps): JSX.Element {
  const { applied } = useProfileFilterState()

  return (
    <div className="mb-7 grid grid-cols-1 gap-5 sm:grid-cols-2">
      <TotalsGroup
        chips={profileTypeChips(totalsByType, applied)}
        label="by type"
      />
      <TotalsGroup
        chips={profileStatusChips(totalsByStatus, applied)}
        label="by status"
      />
    </div>
  )
}

type TotalsGroupProps = {
  chips: readonly ProfileTotalChip[]
  label: string
}

function TotalsGroup({ chips, label }: TotalsGroupProps): JSX.Element {
  const { apply } = useProfileFilterState()

  return (
    <div className="flex flex-col gap-2">
      <span className={cns(PROFILE_GROUP_LABEL)}>{label}</span>
      {chips.length === 0 ? (
        <span className="text-sm text-ink-4">{UNKNOWN_VALUE}</span>
      ) : (
        <div className="flex flex-wrap gap-2" role="group">
          {chips.map(chip => (
            <Chip
              active={chip.active}
              interactive
              key={chip.key}
              label={chip.label}
              onClick={() => apply(chip.next)}
              // `Chip` gives `active` precedence over `tone`, which is what
              // makes a pressed chip read as "applied" rather than as its own
              // status colour — the tone is still passed so releasing it
              // restores the right tint with no second source of truth.
              tone={chip.tone}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * What is currently scoping the table, as removable pills — the same `chip` +
 * "Clear all" idiom `/gallery` uses, so pressing an aggregate chip above reads
 * the same way a filter does everywhere else in the app.
 *
 * Absent entirely when nothing is applied. This row is the tell that something
 * is scoping the table below it, and a permanently-empty row would be one more
 * thing on the page that never says anything.
 */
export function ProfileAppliedFilters(): JSX.Element | null {
  const { applied, apply } = useProfileFilterState()
  const chips = profileFilterChips(applied)

  if (!hasProfileFilters(applied)) {
    return null
  }

  return (
    <div
      aria-label="Active filters"
      className="mb-3 flex flex-wrap items-center gap-2"
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
      <Button
        className={cns(CLEAR_ALL_INLINE)}
        onClick={() => apply(clearProfileFilters(applied))}
        size="sm"
        variant="ghost"
      >
        Clear all
      </Button>
    </div>
  )
}
