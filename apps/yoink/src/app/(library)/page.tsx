import { Suspense } from 'react'

import { GridSkeleton } from 'src/app/(library)/grid-skeleton'
import { SearchContent } from 'src/app/(library)/search/search-content'

export default function SearchPage() {
  return (
    <Suspense fallback={<GridSkeleton />}>
      <SearchContent />
    </Suspense>
  )
}
