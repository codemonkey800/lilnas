'use client'

import { cns } from '@lilnas/utils/cns'
import type { DiscoveryFacets } from '@lilnas/utils/download/types'
import { usePathname, useRouter } from 'next/navigation'
import type { JSX } from 'react'
import { useRef, useState } from 'react'

import type { SearchFilterDraft } from 'src/components/search/search-filters'
import { SearchFilters } from 'src/components/search/search-filters'
import type {
  SearchSort,
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
import { Button } from 'src/components/ui/button'
import {
  AppliedFilterChip,
  FilterPanel,
  FiltersButton,
  FilterScrim,
} from 'src/components/ui/filters'
import type { IconName } from 'src/components/ui/icon'
import { Icon } from 'src/components/ui/icon'
import { Menu, MenuItem } from 'src/components/ui/menu'

/**
 * `search.pug:76`. Two mutually exclusive appearance strings, not a base plus
 * an override — `bg-uv-ghost` and `hover:bg-surface-2` are the same property.
 */
const VIEW_BUTTON = cns(
  'inline-flex h-[30px] w-[30px] items-center justify-center rounded-[7px]',
  'transition-[background-color,color] duration-200 ease-uv',
)

const VIEW_BUTTON_ACTIVE = 'bg-uv-ghost text-uv-hi'
const VIEW_BUTTON_IDLE = 'text-ink-3 hover:bg-surface-2 hover:text-ink'

/**
 * `search.pug:67` sizes the toolbar's controls `sm` on mobile and default on
 * desktop. `size` is a single value, so the responsive pair is expressed as
 * classes — which land last through `cns` and therefore win over whichever
 * size the component picked.
 */
const TOOLBAR_CONTROL = cns(
  'h-[30px] px-[11px] text-[13px]',
  'sm:h-[38px] sm:px-[15px] sm:text-[14px]',
)

const SORT_TRIGGER = cns(
  'h-[30px] px-[11px] text-[13px]',
  'sm:h-[38px] sm:px-3 sm:text-[14px]',
)

const VIEW_OPTIONS: ReadonlyArray<{
  icon: IconName
  label: string
  value: SearchView
}> = [
  // ⚠️ `grid-fill`, not `grid`: they are different glyphs, and the toolbar's
  // switch uses the filled one.
  { icon: 'grid-fill', label: 'Grid view', value: 'grid' },
  { icon: 'list', label: 'List view', value: 'list' },
]

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
          'relative mt-[22px] mb-4 flex flex-wrap items-center justify-between gap-2.5',
          'sm:mt-[30px] sm:mb-[18px] sm:gap-4',
          open && 'z-20',
        )}
      >
        <span className="text-sm text-ink-3">
          {`${total} ${plural}`}
          <span className="hidden sm:inline">{` for “${state.query}”`}</span>
        </span>
        <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
          {showViewToggle ? (
            <div
              aria-label="Result view"
              className="inline-flex shrink-0 gap-0.5 rounded-md border border-line bg-surface p-[3px]"
              role="group"
            >
              {VIEW_OPTIONS.map(option => (
                <button
                  aria-label={option.label}
                  aria-pressed={state.view === option.value}
                  className={cns(
                    VIEW_BUTTON,
                    state.view === option.value
                      ? VIEW_BUTTON_ACTIVE
                      : VIEW_BUTTON_IDLE,
                  )}
                  key={option.value}
                  onClick={() => navigate({ ...state, view: option.value })}
                  type="button"
                >
                  <Icon className="h-[15px] w-[15px]" name={option.icon} />
                </button>
              ))}
            </div>
          ) : null}
          <Menu
            className="w-[150px] shrink-0 sm:w-[168px]"
            label={SEARCH_SORT_LABELS[state.sort]}
            onValueChange={value =>
              navigate({ ...state, sort: value as SearchSort })
            }
            triggerClassName={SORT_TRIGGER}
            triggerProps={{
              'aria-label': `Sort by ${SEARCH_SORT_LABELS[state.sort]}`,
            }}
            value={state.sort}
          >
            {SEARCH_SORTS.map(sort => (
              <MenuItem key={sort} value={sort}>
                {SEARCH_SORT_LABELS[sort]}
              </MenuItem>
            ))}
          </Menu>
          <FiltersButton
            className={TOOLBAR_CONTROL}
            count={count}
            onClick={() => setOpen(!open)}
            open={open}
            ref={triggerRef}
          />
        </div>
        <FilterPanel
          className="absolute top-[calc(100%+10px)] right-0 left-0 sm:left-auto sm:w-[460px]"
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
          className="mb-5 flex flex-wrap gap-2 sm:mb-[22px] sm:gap-[9px]"
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
          <Button
            className="hidden h-[27px] px-2.5 text-[12px] sm:inline-flex"
            onClick={clearFilters}
            size="sm"
            variant="ghost"
          >
            Clear all
          </Button>
        </div>
      ) : null}
    </>
  )
}
