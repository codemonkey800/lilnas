'use client'

import { Button, Icon, Menu, Segmented } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { DiscoveryFacets } from '@lilnas/utils/download/types'
import { usePathname, useRouter } from 'next/navigation'
import type { JSX } from 'react'
import { useRef, useState } from 'react'

import type { SearchFilterDraft } from 'src/components/search/search-filters'
import { SearchFilters } from 'src/components/search/search-filters'
import type {
  SearchState,
  SearchView,
} from 'src/components/search/search-params'
import {
  appliedFilterCount,
  formatYearRange,
  hasAppliedFilters,
  SEARCH_SORT_LABELS,
  SEARCH_SORTS,
  searchStateToQueryString,
} from 'src/components/search/search-params'
import {
  AppliedFilterChip,
  FilterPanel,
  FiltersButton,
  FilterScrim,
} from 'src/components/ui/filters'

/** The grid / list switch: `Segmented`, one radio each. */
const VIEW_OPTIONS = [
  { label: 'Grid', value: 'grid' },
  { label: 'List', value: 'list' },
] as const satisfies ReadonlyArray<{ label: string; value: SearchView }>

export type SearchToolbarProps = {
  /** The genre vocabulary for the current query, for the filter panel. */
  facets: DiscoveryFacets
  /**
   * Hidden when there is nothing to look at either way — `search.pug` drops it
   * from the "No matches" frame.
   */
  showViewToggle?: boolean
  state: SearchState
  /** The size of the whole filtered set, not of the page on screen. */
  total: number
}

/**
 * The bar between the hero and the results: how many matched, how to look at
 * them, how to order them, and what to narrow them by.
 *
 * Every control here writes to the URL and nothing else — this component holds
 * no copy of the filter state, so there is nothing to keep in sync and no
 * effect that could try. `push` rather than the hero's `replace`, because
 * changing a filter or a sort *is* a discrete thing you did and Back should
 * undo exactly one of them.
 *
 * ## Layout
 *
 * The toolbar row is the popover's positioning context, which is what lets the
 * panel span the full row on a phone and sit 460px wide against the right edge
 * on a desktop — `search.pug` draws those as two separate frames with two
 * different anchors. It takes `z-20` only while open, so the sort `Menu`'s own
 * `z-20` panel is not trapped under a stacking context the rest of the time.
 * `FilterScrim` is a sibling at `z-10`: same stacking context, one layer down.
 *
 * ## Deviation from `search.pug`
 *
 * The view switch is a `role="group"` of `aria-pressed` toggle buttons, not
 * the mockup's `role="radiogroup"`. The mockup mixes the two patterns —
 * `aria-pressed` is not a valid state for a child of a radiogroup, which wants
 * `role="radio"` and `aria-checked` — and of the two readings, a pair of
 * toggle buttons is what this actually is.
 */
export function SearchToolbar({
  facets,
  showViewToggle = true,
  state,
  total,
}: SearchToolbarProps): JSX.Element {
  const router = useRouter()
  const pathname = usePathname()

  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  function navigate(next: SearchState): void {
    router.push(`${pathname}${searchStateToQueryString(next)}`, {
      scroll: false,
    })
  }

  function applyFilters(draft: SearchFilterDraft): void {
    setOpen(false)
    navigate({ ...state, ...draft })
  }

  function clearFilters(): void {
    setOpen(false)
    navigate({ ...state, genres: [], yearFrom: null, yearTo: null })
  }

  const count = appliedFilterCount(state)
  const plural = total === 1 ? 'result' : 'results'

  return (
    <>
      <div
        className={cns(
          'relative mb-4 flex items-center justify-between',
          'flex-wrap gap-2 sm:flex-nowrap sm:gap-4',
          open && 'z-20',
        )}
      >
        <span className="text-sm text-ink-3">
          {`${total} ${plural}`}
          <span className="hidden sm:inline">{` for “${state.query}”`}</span>
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {showViewToggle ? (
            <Segmented
              label="Result view"
              options={VIEW_OPTIONS}
              size="sm"
              value={state.view}
              onValueChange={view => navigate({ ...state, view })}
            />
          ) : null}
          <Menu.Root>
            <Menu.Trigger
              render={
                <Button
                  aria-label={`Sort by ${SEARCH_SORT_LABELS[state.sort]}`}
                  icon="sort"
                  iconEnd="chevron"
                  variant="outline"
                />
              }
            >
              <span className="max-sm:hidden">
                Sort: {SEARCH_SORT_LABELS[state.sort]}
              </span>
              <span className="sm:hidden">Sort</span>
            </Menu.Trigger>
            <Menu.Popup align="end">
              {SEARCH_SORTS.map(sort => (
                <Menu.Item
                  aria-checked={state.sort === sort}
                  key={sort}
                  role="menuitemradio"
                  onClick={() => navigate({ ...state, sort })}
                >
                  <span className="flex-1">{SEARCH_SORT_LABELS[sort]}</span>
                  {state.sort === sort ? (
                    <Icon className="size-3.5 text-accent-hi" name="check" />
                  ) : null}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Root>
          <FiltersButton
            count={count}
            open={open}
            ref={triggerRef}
            onClick={() => setOpen(!open)}
          />
        </div>
        <FilterPanel
          className="absolute inset-x-0 top-[calc(100%+8px)] sm:left-auto sm:w-[460px]"
          onOpenChange={setOpen}
          open={open}
          triggerRef={triggerRef}
        >
          <SearchFilters
            facets={facets}
            // Remounts the draft whenever the applied filters change — an open
            // panel whose chips were removed from underneath it re-reads the
            // URL, with no effect to do the syncing.
            key={searchStateToQueryString(state)}
            onApply={applyFilters}
            onClear={clearFilters}
            state={state}
          />
        </FilterPanel>
      </div>
      {open ? <FilterScrim /> : null}
      {hasAppliedFilters(state) ? (
        <div
          aria-label="Active filters"
          className="mb-4 flex flex-wrap items-center gap-2"
          role="group"
        >
          {state.genres.map(genre => (
            <AppliedFilterChip
              key={genre}
              label={genre}
              onRemove={() =>
                navigate({
                  ...state,
                  genres: state.genres.filter(entry => entry !== genre),
                })
              }
              removeLabel={`Remove ${genre} genre filter`}
            />
          ))}
          {state.yearFrom !== null || state.yearTo !== null ? (
            <AppliedFilterChip
              label={formatYearRange(state.yearFrom, state.yearTo)}
              onRemove={() =>
                navigate({ ...state, yearFrom: null, yearTo: null })
              }
              removeLabel="Remove release year filter"
            />
          ) : null}
          <Button onClick={clearFilters} size="sm" variant="ghost">
            Clear all
          </Button>
        </div>
      ) : null}
    </>
  )
}
