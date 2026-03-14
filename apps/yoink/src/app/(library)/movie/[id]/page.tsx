import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { api } from 'src/media/api.server'

import { MovieDetailContent } from './movie-detail-content'
import { MovieDetailSkeleton } from './movie-detail-skeleton'

interface MoviePageProps {
  params: Promise<{ id: string }>
}

async function MovieData({ id }: { id: string }) {
  let movie
  try {
    movie = await api.getMovieById(id)
  } catch {
    notFound()
  }

  if (!movie.id && !movie.tmdbId) notFound()

  const initialDownloadStatus = movie.tmdbId
    ? await api.getMovieDownloadStatus(movie.tmdbId)
    : null

  return (
    <MovieDetailContent
      movie={movie}
      initialDownloadStatus={initialDownloadStatus}
    />
  )
}

export default async function MoviePage({ params }: MoviePageProps) {
  const { id } = await params

  return (
    <Suspense fallback={<MovieDetailSkeleton />}>
      <MovieData id={id} />
    </Suspense>
  )
}
