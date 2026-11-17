'use client'

import { Skeleton } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import { useSearchParams } from 'next/navigation'
import type { JSX } from 'react'

import { parseSearchState } from 'src/components/search/search-params'

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
  'stagger grid grid-cols-2 gap-4',
  'sm:grid-cols-[repeat(auto-fill,minmax(148px,1fr))]',
)

function LoadingGrid(): JSX.Element {
  return (
    <div className={SKELETON_GRID}>
      {GRID_SKELETONS.map(([title, meta], index) => (
        <div
          className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-2.5"
          key={index}
        >
          <Skeleton className="aspect-[2/3] w-full rounded-md" />
          <Skeleton className="h-3.5" style={{ width: title }} />
          <Skeleton className="h-3" style={{ width: meta }} />
        </div>
      ))}
    </div>
  )
}

function LoadingList(): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {LIST_SKELETONS.map((width, index) => (
        <div
          className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2.5"
          key={index}
        >
          <Skeleton className="h-[72px] w-12 shrink-0" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5" style={{ width }} />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * The shape of the answer before the answer arrives: the grid or the list the
 * URL asks for. The hero above it is the page layout's, so it stays put.
 */
export function SearchLoadingSkeleton(): JSX.Element {
  const { view } = parseSearchState(useSearchParams())

  return (
    <div aria-busy="true">
      {view === 'list' ? <LoadingList /> : <LoadingGrid />}
    </div>
  )
}
