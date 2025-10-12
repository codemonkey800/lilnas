import type {
  MovieSearchResult,
  RadarrMovieResource,
} from 'src/media/types/radarr.types'

/**
 * Helper function to filter out empty URLs
 */
const getValidUrl = (url?: string): string | undefined => {
  return url && url.trim() !== '' ? url : undefined
}

/**
 * Helper function to get valid image URL by cover type
 */
const getImageUrl = (
  images: RadarrMovieResource['images'],
  coverType: string,
): string | undefined => {
  const image = images.find(img => img.coverType === coverType)
  return getValidUrl(image?.url)
}

/**
 * Helper function to get valid year
 */
const getValidYear = (year?: number): number | undefined => {
  return year && year >= 1900 && year <= 2100 ? year : undefined
}

/**
 * Transform Radarr movie resource to simplified search result
 * Utility function for converting API responses to standardized format
 */
export function transformToSearchResult(
  movie: RadarrMovieResource,
): MovieSearchResult {
  return {
    tmdbId: movie.tmdbId,
    imdbId: movie.imdbId,
    title: movie.title,
    originalTitle: movie.originalTitle,
    year: getValidYear(movie.year),
    overview: movie.overview,
    runtime: movie.runtime,
    genres: movie.genres,
    rating: movie.ratings?.imdb?.value || movie.ratings?.tmdb?.value,
    posterPath: getImageUrl(movie.images, 'poster'),
    backdropPath: getImageUrl(movie.images, 'fanart'),
    inCinemas: movie.inCinemas,
    physicalRelease: movie.physicalRelease,
    digitalRelease: movie.digitalRelease,
    status: movie.status,
    certification: movie.certification,
    studio: movie.studio,
    website: getValidUrl(movie.website),
    youTubeTrailerId: movie.youTubeTrailerId,
    popularity: movie.popularity,
  }
}

/**
 * Transform multiple Radarr movie resources to search results
 * Convenience function for batch transformation
 */
export function transformToSearchResults(
  movies: RadarrMovieResource[],
): MovieSearchResult[] {
  return movies.map(transformToSearchResult)
}
