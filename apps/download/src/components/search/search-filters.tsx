'use client'

import type { DiscoveryFacets } from '@lilnas/utils/download/types'
import type { JSX } from 'react'
import { useState } from 'react'

import type { SearchState } from 'src/components/search/search-params'
import {
  parseYear,
  YEAR_RANGE_ERROR,
  YEAR_RANGE_SEPARATOR,
} from 'src/components/search/search-params'
import { Button } from 'src/components/ui/button'
import { FilterFoot, FilterGrid, FilterGroup } from 'src/components/ui/filters'
import { Icon } from 'src/components/ui/icon'
import { Input } from 'src/components/ui/input'
import { ToggleChip } from 'src/components/ui/toggle-chip'

/**
 * `search.pug:96` — a fixed 76px field, reddened while the range is impossible.
 * Two mutually exclusive strings rather than a base plus an override: `border-bad!`
 * and the base border are the same property, and `!` utilities are resolved by
 * output order, not source order.
 */
const YEAR_FIELD = 'w-[76px]!'
const YEAR_FIELD_INVALID = 'w-[76px]! border-bad!'

/** The subset of {@link SearchState} this panel edits. */
export interface SearchFilterDraft {
  genres: string[]
  yearFrom: number | null
  yearTo: number | null
}

export type SearchFiltersProps = {
  /**
   * The genre vocabulary the API computed for the *current* query. Genres
   * already applied are merged in even when they are absent here, so a filter
   * that has narrowed itself out of its own facet list can still be removed.
   */
  facets: DiscoveryFacets
  onApply: (draft: SearchFilterDraft) => void
  onClear: () => void
  state: SearchState
}

function yearToText(year: number | null): string {
  return year === null ? '' : String(year)
}

/**
 * The genre chips to draw: the API's facets, plus anything applied that the
 * facets no longer mention, in that order.
 */
function genreOptions(facets: DiscoveryFacets, applied: string[]): string[] {
  const fromFacets = facets.genres.map(entry => entry.genre)
  const missing = applied.filter(genre => !fromFacets.includes(genre))

  return [...fromFacets, ...missing]
}

/**
 * The contents of `/search`'s filter popover — genre, and a release-year range.
 *
 * Everything here is a *draft*: nothing reaches the URL until "Show results".
 * That is what makes it safe to have no effects at all. The panel is unmounted
 * whenever it is closed (`FilterPanel` returns `null`), and the toolbar gives
 * it a `key` derived from the applied filters, so every open starts from the
 * URL by construction rather than by an effect that syncs it.
 *
 * ## Deviations from `search.pug`
 *
 * - No `sort by` group. The mockup nests the sort menu in this panel; sort is
 *   not a filter, it survives a filter reset, and the table's own column
 *   headers drive it too — so it lives in the toolbar beside the view toggle.
 * - The confirm reads "Show results", never "Show 8 results". The count of an
 *   *unapplied* draft is not knowable without spending the request the button
 *   exists to trigger. "Show results" is the mockup's own wording for the
 *   state where it cannot promise a number.
 * - The year pair is deliberately not inside a `Field`: a `Field` names one
 *   control, and there are two. Each input names itself, and `FilterGroup`'s
 *   `role="group"` carries "release year" over both.
 */
export function SearchFilters({
  facets,
  onApply,
  onClear,
  state,
}: SearchFiltersProps): JSX.Element {
  const [genres, setGenres] = useState<string[]>(state.genres)
  const [fromText, setFromText] = useState(yearToText(state.yearFrom))
  const [toText, setToText] = useState(yearToText(state.yearTo))

  const yearFrom = parseYear(fromText)
  const yearTo = parseYear(toText)

  // Only a *complete* pair can be inverted. A half-typed `20` parses to null,
  // so the error cannot flash at you on the way to `2012`.
  const invalid = yearFrom !== null && yearTo !== null && yearFrom > yearTo

  const options = genreOptions(facets, state.genres)

  function toggleGenre(genre: string, checked: boolean): void {
    setGenres(current =>
      checked ? [...current, genre] : current.filter(entry => entry !== genre),
    )
  }

  return (
    <>
      <FilterGrid>
        <FilterGroup label="genre" wide>
          {options.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {options.map(genre => (
                <ToggleChip
                  checked={genres.includes(genre)}
                  key={genre}
                  label={genre}
                  onCheckedChange={checked => toggleGenre(genre, checked)}
                  value={genre}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-3">No genres in these results.</p>
          )}
        </FilterGroup>
        <FilterGroup label="release year">
          <div className="flex items-center gap-2">
            <Input
              aria-invalid={invalid || undefined}
              aria-label="Start year"
              className={invalid ? YEAR_FIELD_INVALID : YEAR_FIELD}
              inputMode="numeric"
              maxLength={4}
              mono
              onChange={event => setFromText(event.target.value)}
              placeholder="1999"
              value={fromText}
            />
            <span className="text-ink-3">{YEAR_RANGE_SEPARATOR}</span>
            <Input
              aria-invalid={invalid || undefined}
              aria-label="End year"
              className={invalid ? YEAR_FIELD_INVALID : YEAR_FIELD}
              inputMode="numeric"
              maxLength={4}
              mono
              onChange={event => setToText(event.target.value)}
              placeholder="2012"
              value={toText}
            />
          </div>
          {invalid ? (
            <span className="flex items-center gap-[5px] font-mono text-[11px] text-bad">
              <Icon className="h-[11px] w-[11px] shrink-0" name="alert" />
              {YEAR_RANGE_ERROR}
            </span>
          ) : null}
        </FilterGroup>
      </FilterGrid>
      <FilterFoot>
        <Button onClick={onClear} size="sm" variant="ghost">
          Clear all
        </Button>
        <Button
          disabled={invalid}
          onClick={() => onApply({ genres, yearFrom, yearTo })}
          size="sm"
          variant="uv"
        >
          Show results
        </Button>
      </FilterFoot>
    </>
  )
}
