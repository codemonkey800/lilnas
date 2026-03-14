'use server'

import { revalidatePath } from 'next/cache'

import {
  api,
  type DeleteMovieFileParams,
  type GrabMovieReleaseParams,
  type RemoveMovieFromLibraryParams,
  type SetMovieMonitoredParams,
} from 'src/media/api.server'

export async function searchReleases(movieId: number) {
  return api.searchMovieReleases(movieId)
}

export async function addMovieToLibrary(tmdbId: number) {
  return api.addMovieToLibrary(tmdbId)
}

export async function cancelDownload(tmdbId: number) {
  await api.cancelMovieDownload(tmdbId)
  revalidatePath(`/movie/${tmdbId}`)
}

export async function deleteMovieFile(params: DeleteMovieFileParams) {
  await api.deleteMovieFile(params)
  revalidatePath(`/movie/${params.tmdbId}`)
}

export async function grabRelease(params: GrabMovieReleaseParams) {
  await api.grabMovieRelease(params)
  revalidatePath(`/movie/${params.tmdbId}`)
}

export async function setMovieMonitored(params: SetMovieMonitoredParams) {
  await api.setMovieMonitored(params)
  revalidatePath(`/movie/${params.tmdbId}`)
}

export async function removeMovieFromLibrary(
  params: RemoveMovieFromLibraryParams,
) {
  await api.removeMovieFromLibrary(params)
  if (params.tmdbId) {
    revalidatePath(`/movie/${params.tmdbId}`)
  }
}
