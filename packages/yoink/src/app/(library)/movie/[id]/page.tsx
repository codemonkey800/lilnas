import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { getMovie } from 'src/media'

import { MovieDetailContent } from './movie-detail-content'
import { MovieDetailSkeleton } from './movie-detail-skeleton'

interface MoviePageProps {
  params: Promise<{ id: string }>
}

async function MovieData({ id }: { id: string }) {
  let movie
  try {
    movie = await getMovie(id)
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
