'use client'

import { cns } from '@lilnas/utils/cns'
import SearchIcon from '@mui/icons-material/Search'
import SearchOffIcon from '@mui/icons-material/SearchOff'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { GridSkeleton } from 'src/app/(library)/grid-skeleton'
import { searchMedia } from 'src/app/(library)/search/actions'
import { EmptyState } from 'src/components/empty-state'
import { FilterToggle, type FilterValue } from 'src/components/filter-toggle'
import { MediaCard } from 'src/components/media-card'
import { SearchBar } from 'src/components/search-bar'
import { SortSelect, type SortValue } from 'src/components/sort-select'
import type { LibraryItem } from 'src/lib/media'
import { sortItems } from 'src/lib/sort'

const DEBOUNCE_MS = 400

export function SearchContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialQuery = searchParams.get('q') ?? ''

  const [query, setQuery] = useState(initialQuery)
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery)
  const [filter, setFilter] = useState<FilterValue>('all')
  const [sort, setSort] = useState<SortValue>('relevance')
  const [results, setResults] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(!!initialQuery)
  const fetchIdRef = useRef(0)
  const isInitialRender = useRef(true)

  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false
      return
    }
    const timer = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const trimmed = debouncedQuery.trim()
    const url = trimmed ? `/?q=${encodeURIComponent(trimmed)}` : '/'
    router.replace(url, { scroll: false })
  }, [debouncedQuery, router])

  useEffect(() => {
    const trimmed = debouncedQuery.trim()
    if (!trimmed) {
      fetchIdRef.current++
      return
    }

    const id = ++fetchIdRef.current

    searchMedia(trimmed, filter).then(data => {
      if (id !== fetchIdRef.current) return
      setResults(data)
      setLoading(false)
    })
  }, [debouncedQuery, filter])

  const sortedResults = useMemo(
    () => sortItems(results, sort),
    [results, sort],
  )

  function handleQueryChange(value: string) {
    setQuery(value)
    if (value.trim()) {
      setLoading(true)
    } else {
      setLoading(false)
      setResults([])
    }
  }

  function handleFilterChange(value: FilterValue) {
    setFilter(value)
    if (debouncedQuery.trim()) setLoading(true)
  }

  const hasQuery = !!debouncedQuery.trim()

  return (
    <>
      <div
        className={cns(
          'sticky top-0 z-10 -mx-6 px-6 py-4',
          'bg-carbon-900/95 backdrop-blur-sm',
        )}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <SearchBar query={query} onQueryChange={handleQueryChange} />
          </div>
          <SortSelect value={sort} onChange={setSort} showRelevance />
          <FilterToggle value={filter} onChange={handleFilterChange} />
        </div>
      </div>

      {loading ? (
        <GridSkeleton />
      ) : hasQuery && sortedResults.length === 0 ? (
        <EmptyState
          className="mt-16"
          icon={<SearchOffIcon />}
          title="No results"
          description="Try a different search term or adjust the filter."
        />
      ) : !hasQuery ? (
        <EmptyState
          className="mt-16"
          icon={<SearchIcon />}
          title="Search for media"
          description="Find movies, TV shows, and more to add to your library."
        />
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {sortedResults.map(item => (
            <MediaCard
              key={`${item.mediaType}-${item.id}`}
              item={item}
              showMediaType={filter === 'all'}
            />
          ))}
        </div>
      )}
    </>
  )
}
