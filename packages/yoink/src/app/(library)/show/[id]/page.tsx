import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { api } from 'src/media/api.server'

import { ShowDetailContent } from './show-detail-content'
import { ShowDetailSkeleton } from './show-detail-skeleton'

interface ShowPageProps {
  params: Promise<{ id: string }>
}

async function ShowData({ id }: { id: string }) {
  let show
  try {
    show = await api.getShowById(id)
  } catch {
    notFound()
  }

  if (!show.id && !show.tvdbId) notFound()

  const initialDownloadStatus = show.tvdbId
    ? await api.getShowDownloadStatus(show.tvdbId)
    : []

  return (
    <ShowDetailContent
      show={show}
      initialDownloadStatus={initialDownloadStatus}
    />
  )
}

export default async function ShowPage({ params }: ShowPageProps) {
  const { id } = await params

  return (
    <Suspense fallback={<ShowDetailSkeleton />}>
      <ShowData id={id} />
    </Suspense>
  )
}
