'use client'

import { cns } from '@lilnas/utils/cns'
import type { Media } from '@lilnas/utils/download/types'
import type { JSX, ReactNode } from 'react'

import {
  RESULT_KIND_ICONS,
  RESULT_KIND_LABELS,
  resultGenres,
  resultRuntime,
  resultYear,
} from 'src/components/search/result-meta'
import type { SearchSort } from 'src/components/search/search-params'
import { SEARCH_SORT_DIRECTIONS } from 'src/components/search/search-params'
import { Card } from 'src/components/ui/card'
import { DataTable } from 'src/components/ui/data-table'
import { Icon } from 'src/components/ui/icon'
import { MChip } from 'src/components/ui/mchip'
import { Poster } from 'src/components/ui/poster'
import { UNKNOWN_VALUE } from 'src/lib/format'
import { mediaHref } from 'src/lib/media-route'

/** `search.pug:155`. `font-[inherit]`/`tracking-[inherit]` keep the `th` face. */
const TH_SORT = cns(
  'inline-flex items-center gap-[5px] font-[inherit] tracking-[inherit]',
  'uppercase transition-colors duration-200 ease-uv',
)

const TH_SORT_ACTIVE = 'text-uv-hi'
const TH_SORT_IDLE = 'text-inherit hover:text-ink-2'

const MONO_CELL = 'font-mono text-mono-sm tabular-nums'
const TITLE_LINK =
  'text-sm transition-colors duration-200 ease-uv hover:text-uv-hi'

/**
 * Which `<th>` drives which API ordering.
 *
 * ⚠️ Only two of the five columns are in here, and that is the point. The
 * sort vocabulary is `DiscoverQuerySchema`'s `sort` enum —
 * `relevance | title | releaseDate` — and the result set is cursor-paginated,
 * so a column the API cannot order by has no honest header control: clicking
 * it could only reorder the rows already fetched, which would disagree with
 * the next page the moment it arrived. `type`, `genre` and `runtime` are plain
 * labels.
 */
const SORTABLE_COLUMNS = {
  title: 'title',
  year: 'releaseDate',
} as const satisfies Record<string, SearchSort>

type SortHeaderProps = {
  /** The ordering this column applies. */
  column: (typeof SORTABLE_COLUMNS)[keyof typeof SORTABLE_COLUMNS]
  label: ReactNode
  onSortChange: (sort: SearchSort) => void
  sort: SearchSort
}

/**
 * A sortable column header. Active, it shows a direction chevron pointing the
 * way the API actually orders that column (`title` ascending, `releaseDate`
 * newest-first); inactive, the neutral two-way `sort` glyph.
 *
 * ⚠️ `i-sort` has `viewBox="0 0 10 10"` where every other glyph is 16×16.
 * That is verbatim from the sprite source and scales correctly — the 9px box
 * `search.pug:164` gives it is not a mistake.
 */
function SortHeader({
  column,
  label,
  onSortChange,
  sort,
}: SortHeaderProps): JSX.Element {
  const active = sort === column
  const direction = SEARCH_SORT_DIRECTIONS[column]

  return (
    <button
      className={cns(TH_SORT, active ? TH_SORT_ACTIVE : TH_SORT_IDLE)}
      onClick={() => onSortChange(column)}
      type="button"
    >
      {label}
      {active ? (
        <Icon
          className={cns(
            'h-[11px] w-[11px] shrink-0 text-uv-hi',
            direction === 'ascending' && 'rotate-180',
          )}
          name="chevron"
        />
      ) : (
        <Icon className="h-[9px] w-[9px] shrink-0 text-ink-4" name="sort" />
      )}
    </button>
  )
}

function ariaSort(
  sort: SearchSort,
  column: (typeof SORTABLE_COLUMNS)[keyof typeof SORTABLE_COLUMNS],
): 'ascending' | 'descending' | 'none' {
  return sort === column ? SEARCH_SORT_DIRECTIONS[column] : 'none'
}

export type ResultTableProps = {
  items: Media[]
  onSortChange: (sort: SearchSort) => void
  sort: SearchSort
}

/**
 * Results as a sortable table, for scanning full metadata at once.
 *
 * `DataTable` renders the `<table>` and every cell rule as descendant variants,
 * so the rows below are plain markup with no classes on the cells except the
 * `!` overrides that have to beat those variants.
 *
 * Narrow viewports scroll sideways rather than reflowing, exactly as
 * `search.pug:172` does — the `type` column drops out below `sm` and the rest
 * sits on a `min-w-[480px]` table inside an `overflow-x-auto` card.
 *
 * ## Deviation from `search.pug`
 *
 * The last column is `runtime`, not `seasons`. `Media` carries no season
 * count from either upstream, and a column of em dashes is worse than a column
 * of facts. Runtime keeps the mockup's shape — right-aligned, tabular, dimmed
 * to `ink-4` when unknown — over data that exists.
 */
export function ResultTable({
  items,
  onSortChange,
  sort,
}: ResultTableProps): JSX.Element {
  return (
    <div>
      <p className="mb-2 font-mono text-mono-sm text-ink-4 sm:hidden">
        Scroll for genre →
      </p>
      {/* `overflow-x-auto` at every width, not just below `sm` as
          `search.pug` has it: real genre lists run to five entries where the
          mockup's run to two, and the table's answer to not fitting is to
          scroll sideways, never to reflow. It costs nothing when it fits. */}
      <Card className="overflow-x-auto px-1.5 pt-1 pb-1.5">
        <DataTable className="min-w-[480px] sm:min-w-0">
          <thead>
            <tr>
              <th
                aria-sort={ariaSort(sort, SORTABLE_COLUMNS.title)}
                className="w-[42%] sm:w-[36%]"
              >
                <SortHeader
                  column={SORTABLE_COLUMNS.title}
                  label="title"
                  onSortChange={onSortChange}
                  sort={sort}
                />
              </th>
              <th className="hidden sm:table-cell">type</th>
              <th aria-sort={ariaSort(sort, SORTABLE_COLUMNS.year)}>
                <SortHeader
                  column={SORTABLE_COLUMNS.year}
                  label="year"
                  onSortChange={onSortChange}
                  sort={sort}
                />
              </th>
              <th>genre</th>
              <th className="text-right!">runtime</th>
            </tr>
          </thead>
          <tbody className="stagger">
            {items.map(media => {
              const runtime = resultRuntime(media)

              return (
                <tr key={media.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Poster
                        className="w-[30px] sm:w-[34px]"
                        seed={media.id}
                        shape="tall"
                        src={media.posterUrl}
                      />
                      <a className={TITLE_LINK} href={mediaHref(media)}>
                        {media.title}
                      </a>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell">
                    <MChip
                      className="font-mono text-mono-sm text-ink-3"
                      icon={RESULT_KIND_ICONS[media.type]}
                      label={RESULT_KIND_LABELS[media.type]}
                    />
                  </td>
                  <td className={MONO_CELL}>{resultYear(media)}</td>
                  <td className="font-mono text-mono-sm whitespace-nowrap text-ink-3">
                    {resultGenres(media)}
                  </td>
                  <td
                    className={cns(
                      'text-right!',
                      MONO_CELL,
                      runtime === UNKNOWN_VALUE && 'text-ink-4',
                    )}
                  >
                    {runtime}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </DataTable>
      </Card>
    </div>
  )
}
