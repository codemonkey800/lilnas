'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'

import { FilterToggle, type FilterValue } from 'src/components/filter-toggle'
import { SortSelect, type SortValue } from 'src/components/sort-select'

interface SortFilterState {
  sort: SortValue
  filter: FilterValue
}

const LibrarySortFilterContext = createContext<SortFilterState>({
  sort: 'title-asc',
  filter: 'all',
})

export function useLibrarySortFilter() {
  return useContext(LibrarySortFilterContext)
}

interface LibraryContentProps {
  children: ReactNode
}

export function LibraryContent({ children }: LibraryContentProps) {
  const [filter, setFilter] = useState<FilterValue>('all')
  const [sort, setSort] = useState<SortValue>('title-asc')

  return (
    <LibrarySortFilterContext.Provider value={{ sort, filter }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-3xl">Library</h2>
        <div className="flex items-center gap-2">
          <SortSelect value={sort} onChange={setSort} />
          <FilterToggle value={filter} onChange={setFilter} />
        </div>
      </div>
      {children}
    </LibrarySortFilterContext.Provider>
  )
}
