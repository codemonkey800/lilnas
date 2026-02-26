import type { SortValue } from 'src/components/sort-select'
import type { LibraryItem } from 'src/lib/media'

function compareDate(a: string | null, b: string | null): number {
  const ta = a ? new Date(a).getTime() : 0
  const tb = b ? new Date(b).getTime() : 0
  return ta - tb
}

export function sortItems(
  items: LibraryItem[],
  sort: SortValue,
): LibraryItem[] {
  if (sort === 'relevance') return items

  const sorted = [...items]
  switch (sort) {
    case 'title-asc':
      return sorted.sort((a, b) => a.title.localeCompare(b.title))
    case 'title-desc':
      return sorted.sort((a, b) => b.title.localeCompare(a.title))
    case 'added-desc':
      return sorted.sort((a, b) => compareDate(b.addedAt, a.addedAt))
    case 'added-asc':
      return sorted.sort((a, b) => compareDate(a.addedAt, b.addedAt))
    case 'release-desc':
      return sorted.sort((a, b) => compareDate(b.releaseDate, a.releaseDate))
    case 'release-asc':
      return sorted.sort((a, b) => compareDate(a.releaseDate, b.releaseDate))
  }
}
