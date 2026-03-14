import { type MediaCover, type MovieResource } from '@lilnas/media/radarr-next'
import { type SeriesResource } from '@lilnas/media/sonarr'

export interface LibraryItem {
  id: number
  title: string
  year: number
  posterUrl: string | null
  mediaType: 'movie' | 'show'
  quality: string | null
  status: 'downloaded' | 'missing'
  href: string
  addedAt: string
  releaseDate: string | null
}

export type SearchFilter = 'all' | 'movies' | 'shows'

export function getPosterUrl(images?: Array<MediaCover> | null): string | null {
  const poster = images?.find(img => img.coverType === 'poster')
  return poster?.remoteUrl ?? poster?.url ?? null
}

export function movieToLibraryItem(movie: MovieResource): LibraryItem {
  return {
    id: movie.id ?? 0,
    title: movie.title ?? 'Unknown',
    year: movie.year ?? 0,
    posterUrl: getPosterUrl(movie.images),
    mediaType: 'movie',
    quality: movie.movieFile?.quality?.quality?.name ?? null,
    status: movie.hasFile ? 'downloaded' : 'missing',
    href: `/movie/${movie.tmdbId}`,
    addedAt: movie.added ?? new Date(0).toISOString(),
    releaseDate:
      movie.releaseDate ?? movie.digitalRelease ?? movie.inCinemas ?? null,
  }
}

export function seriesToLibraryItem(series: SeriesResource): LibraryItem {
  return {
    id: series.id ?? 0,
    title: series.title ?? 'Unknown',
    year: series.year ?? 0,
    posterUrl: getPosterUrl(
      series.images as Array<MediaCover> | null | undefined,
    ),
    mediaType: 'show',
    quality: null,
    status:
      (series.statistics?.episodeFileCount ?? 0) > 0 ? 'downloaded' : 'missing',
    href: `/show/${series.tvdbId}`,
    addedAt: series.added ?? new Date(0).toISOString(),
    releaseDate: series.firstAired ?? null,
  }
}

export function interleave(a: LibraryItem[], b: LibraryItem[]): LibraryItem[] {
  const result: LibraryItem[] = []
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if (i < a.length) result.push(a[i]!)
    if (i < b.length) result.push(b[i]!)
  }
  return result
}
