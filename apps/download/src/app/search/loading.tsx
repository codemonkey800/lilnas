import type { JSX } from 'react'

import { SearchLoadingSkeleton } from 'src/components/search/search-skeletons'

/**
 * `/search`'s loading boundary.
 *
 * It covers the results and nothing else: the hero is in `layout.tsx`, above
 * this boundary, so the field keeps its caret while the query it just pushed
 * is being answered. The in-flight state is reported up there too, by the
 * spinner that replaces the field's search glyph.
 */
export default function SearchLoading(): JSX.Element {
  return <SearchLoadingSkeleton />
}
