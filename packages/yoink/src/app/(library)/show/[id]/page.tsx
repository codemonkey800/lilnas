import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { getSearchState } from 'src/media/show-search-store'
import { getShow } from 'src/media/shows.server'

import { ShowDetailContent } from './show-detail-content'
import { ShowDetailSkeleton } from './show-detail-skeleton'

interface ShowPageProps {
  params: Promise<{ id: string }>
}

async function ShowData({ id }: { id: string }) {
  let show
  try {
    show = await getShow(id)
  } catch {
    notFound()
  }

  if (!show.id && !show.tvdbId) notFound()

  const initialSearchState = getSearchState(show.id)

  return <ShowDetailContent show={show} initialSearchState={initialSearchState} />
}

export default async function ShowPage({ params }: ShowPageProps) {
  const { id } = await params

  return (
    <Suspense fallback={<ShowDetailSkeleton />}>
      <ShowData id={id} />
    </Suspense>
  )
}
