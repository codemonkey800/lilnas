import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { ApiClient } from 'src/media/api'

import { MovieDetailContent } from './movie-detail-content'
import { MovieDetailSkeleton } from './movie-detail-skeleton'

interface MoviePageProps {
  params: Promise<{ id: string }>
}

async function MovieData({ id }: { id: string }) {
  let movie
  try {
    const api = new ApiClient()
    movie = await api.getMovieById(id)
  } catch {
    notFound()
  }

  if (!movie.id && !movie.tmdbId) notFound()
  return <MovieDetailContent movie={movie} />
}

export default async function MoviePage({ params }: MoviePageProps) {
  const { id } = await params

  return (
    <Suspense fallback={<MovieDetailSkeleton />}>
      <MovieData id={id} />
    </Suspense>
  )
}
