import { Suspense } from 'react'

import { GridSkeleton } from 'src/app/(library)/grid-skeleton'
import { LibraryContent } from 'src/app/(library)/library-content'
import { LibraryGrid } from 'src/app/(library)/library-grid'
import { api } from 'src/media/api.server'

async function LibraryData() {
  const items = await api.getLibrary()
  return <LibraryGrid items={items} />
}

export default function LibraryPage() {
  return (
    <LibraryContent>
      <Suspense fallback={<GridSkeleton />}>
        <LibraryData />
      </Suspense>
    </LibraryContent>
  )
}
