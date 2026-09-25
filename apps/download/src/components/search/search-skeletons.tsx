'use client'

import { cns } from '@lilnas/utils/cns'
import { useSearchParams } from 'next/navigation'
import type { JSX } from 'react'

import { parseSearchState } from 'src/components/search/search-params'
import { Card } from 'src/components/ui/card'
import { DataTable } from 'src/components/ui/data-table'
import { Skeleton } from 'src/components/ui/feedback'

/**
 * `search.mjs`'s `GRID_SKELETONS` — title and metadata widths, varied so the
 * loading grid does not read as a checkerboard. Inline styles rather than
 * classes for the same reason `ui.pug` uses them: eight arbitrary percentages
 * are data, not a design vocabulary, and Tailwind's scanner would have to be
 * told about each one.
 */
const GRID_SKELETONS: ReadonlyArray<[string, string]> = [
  ['85%', '45%'],
  ['70%', '40%'],
  ['90%', '35%'],
  ['65%', '45%'],
  ['80%', '30%'],
  ['75%', '40%'],
  ['60%', '45%'],
  ['85%', '35%'],
  ['72%', '42%'],
  ['88%', '38%'],
  ['68%', '32%'],
  ['95%', '48%'],
  ['62%', '36%'],
  ['78%', '44%'],
  ['83%', '30%'],
  ['67%', '40%'],
  ['92%', '34%'],
  ['71%', '46%'],
  ['86%', '38%'],
  ['64%', '42%'],
  ['79%', '36%'],
  ['73%', '48%'],
  ['91%', '32%'],
  ['66%', '44%'],
]

/** `search.mjs`'s `LIST_SKELETONS`. */
const LIST_SKELETONS: readonly string[] = [
  '120px',
  '95px',
  '140px',
  '105px',
  '85px',
]

/** Matches `ResultGrid`'s own track sizing exactly, so nothing shifts. */
const SKELETON_GRID = cns(
  'stagger grid gap-3 grid-cols-[repeat(auto-fill,minmax(128px,1fr))]',
  'sm:gap-4 sm:grid-cols-[repeat(auto-fill,minmax(148px,1fr))]',
)

function LoadingGrid(): JSX.Element {
  return (
    <div className={SKELETON_GRID}>
      {GRID_SKELETONS.map(([title, meta], index) => (
        <div
          className="flex flex-col gap-[9px] rounded-lg border border-line bg-surface p-[9px]"
          key={index}
        >
          <Skeleton className="aspect-[2/3] w-full rounded-md" />
          <Skeleton className="h-[13px]" style={{ width: title }} />
          <Skeleton className="h-2.5" style={{ width: meta }} />
        </div>
      ))}
    </div>
  )
}

function LoadingTable(): JSX.Element {
  return (
    <Card className="overflow-x-auto px-1.5 pt-1 pb-1.5">
      <DataTable className="min-w-[480px] sm:min-w-0">
        <thead>
          <tr>
            <th className="w-[42%] sm:w-[36%]">title</th>
            <th className="hidden sm:table-cell">type</th>
            <th>year</th>
            <th>genre</th>
            <th className="text-right!">runtime</th>
          </tr>
        </thead>
        <tbody>
          {LIST_SKELETONS.map((width, index) => (
            <tr key={index}>
              <td>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-[50px] w-[34px] shrink-0" />
                  <Skeleton className="h-[13px]" style={{ width }} />
                </div>
              </td>
              <td className="hidden sm:table-cell">
                <Skeleton className="h-[11px] w-[46px]" />
              </td>
              <td>
                <Skeleton className="h-[11px] w-8" />
              </td>
              <td>
                <Skeleton className="h-[11px] w-16" />
              </td>
              <td className="text-right!">
                <Skeleton className="ml-auto h-[11px] w-[18px]" />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </Card>
  )
}

/**
 * The shape of the answer before the answer arrives — `/search`'s route-level
 * `loading.tsx`.
 *
 * A client component purely so it can read `?view=` and put up the skeleton
 * for the view you are actually in: `loading.tsx` is handed no props and has
 * no access to `searchParams`, and a grid of poster tiles flashing in front of
 * a table is a worse frame than no frame at all.
 *
 * The hero is *not* here, and does not need to be: it lives in
 * `src/app/search/layout.tsx`, above this boundary, so the field you are
 * typing into is never unmounted and re-mounted by its own keystrokes.
 */
export function SearchLoadingSkeleton(): JSX.Element {
  const { view } = parseSearchState(useSearchParams())

  return (
    <div className="mt-[22px] sm:mt-[30px]">
      {view === 'list' ? <LoadingTable /> : <LoadingGrid />}
    </div>
  )
}
