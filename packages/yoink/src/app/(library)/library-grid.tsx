'use client'

import MovieIcon from '@mui/icons-material/Movie'
import Button from '@mui/material/Button'
import { useVirtualizer } from '@tanstack/react-virtual'
import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'

import { useLibrarySortFilter } from 'src/app/(library)/library-content'
import { EmptyState } from 'src/components/empty-state'
import { MediaCard } from 'src/components/media-card'
import { useScrollContainer } from 'src/components/shell/scroll-container'
import { useResponsiveColumns } from 'src/hooks/use-responsive-columns'
import type { LibraryItem } from 'src/lib/media'
import { sortItems } from 'src/lib/sort'

const ESTIMATED_ROW_HEIGHT = 340
const OVERSCAN = 3

interface LibraryGridProps {
  items: LibraryItem[]
}

export function LibraryGrid({ items }: LibraryGridProps) {
  const { sort, filter } = useLibrarySortFilter()
  const scrollEl = useScrollContainer()
  const [scrollMargin, setScrollMargin] = useState(0)
  const columns = useResponsiveColumns()

  const gridRef = useCallback((el: HTMLDivElement | null) => {
    setScrollMargin(el?.offsetTop ?? 0)
  }, [])

  const filtered = useMemo(() => {
    const subset =
      filter === 'all'
        ? items
        : items.filter(item =>
            filter === 'movies'
              ? item.mediaType === 'movie'
              : item.mediaType === 'show',
          )
    return sortItems(subset, sort)
  }, [items, filter, sort])

  const rowCount = Math.ceil(filtered.length / columns)

  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer returns unstable references by design
  const virtualizer = useVirtualizer({
    count: rowCount,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: OVERSCAN,
    scrollMargin,
    getScrollElement: () => scrollEl,
  })

  if (filtered.length === 0) {
    return (
      <EmptyState
        className="mt-16"
        icon={<MovieIcon />}
        title="No movies or shows downloaded yet"
        description="Search for media to start building your library."
        action={
          <Button
            component={Link}
            href="/"
            variant="outlined"
            color="primary"
          >
            Browse
          </Button>
        }
      />
    )
  }

  return (
    <div ref={gridRef} className="mt-6">
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: 'relative',
          width: '100%',
        }}
      >
        {virtualizer.getVirtualItems().map(virtualRow => {
          const start = virtualRow.index * columns
          const rowItems = filtered.slice(start, start + columns)

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
              }}
              className="grid grid-cols-2 gap-4 pb-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
            >
              {rowItems.map(item => (
                <MediaCard
                  key={`${item.mediaType}-${item.id}`}
                  item={item}
                  showMediaType={filter === 'all'}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
