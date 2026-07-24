// Pure search/filter logic for the iPad's library grid (IpadBrowser.tsx),
// pulled out of that component so it's unit-testable under this app's
// existing jest config — jest's `testMatch` here only picks up `.ts` files,
// not `.tsx`, and there's no jsdom/React-testing-library setup to render the
// component itself anyway.

export type LibraryTypeFilter = 'all' | 'movie' | 'series'

// Generic over anything with at least `name`/`type`, rather than importing
// IpadBrowser.tsx's own hand-duplicated `TheaterItem` type, so this module
// has no dependency on that file (and could just as easily filter the
// episode list if that ever grows a name/type shape of its own).
export function filterLibraryItems<
  T extends { name: string; type: 'movie' | 'series' },
>(items: T[], search: string, typeFilter: LibraryTypeFilter): T[] {
  const query = search.trim().toLowerCase()

  return items.filter(item => {
    if (typeFilter !== 'all' && item.type !== typeFilter) {
      return false
    }
    if (query.length > 0 && !item.name.toLowerCase().includes(query)) {
      return false
    }
    return true
  })
}
