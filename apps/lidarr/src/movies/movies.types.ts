import {
  type MediaCover,
  type MovieFileResource,
  type MovieResource,
} from '@lilnas/media/radarr-next'

export interface MovieFileInfo {
  id: number
  relativePath: string | null
  size: number
  quality: string | null
  dateAdded: string | null
}

export interface MovieDetail {
  id: number
  tmdbId: number | null
  title: string
  year: number
  runtime: number | null
  certification: string | null
  overview: string | null
  posterUrl: string | null
  fanartUrl: string | null
  quality: string | null
  status: 'downloaded' | 'missing'
  genres: string[]
  ratings: { imdb: number | null; tmdb: number | null }
  sizeOnDisk: number | null
  files: MovieFileInfo[]
}

function getImageUrl(
  images: Array<MediaCover> | null | undefined,
  type: 'poster' | 'fanart',
): string | null {
  const img = images?.find(i => i.coverType === type)
  return img?.remoteUrl ?? img?.url ?? null
}

function movieFileToInfo(f: MovieFileResource): MovieFileInfo {
  return {
    id: f.id ?? 0,
    relativePath: f.relativePath ?? null,
    size: f.size ?? 0,
    quality: f.quality?.quality?.name ?? null,
    dateAdded: f.dateAdded ?? null,
  }
}

export function movieResourceToDetail(
  movie: MovieResource,
  files: MovieFileResource[],
): MovieDetail {
  return {
    id: movie.id ?? 0,
    tmdbId: movie.tmdbId ?? null,
    title: movie.title ?? 'Unknown',
    year: movie.year ?? 0,
    runtime: movie.runtime ?? null,
    certification: movie.certification ?? null,
    overview: movie.overview ?? null,
    posterUrl: getImageUrl(movie.images, 'poster'),
    fanartUrl: getImageUrl(movie.images, 'fanart'),
    quality: movie.movieFile?.quality?.quality?.name ?? null,
    status: movie.hasFile ? 'downloaded' : 'missing',
    genres: movie.genres ?? [],
    ratings: {
      imdb: movie.ratings?.imdb?.value ?? null,
      tmdb: movie.ratings?.tmdb?.value ?? null,
    },
    sizeOnDisk: movie.sizeOnDisk ?? null,
    files: files.map(movieFileToInfo),
  }
}
