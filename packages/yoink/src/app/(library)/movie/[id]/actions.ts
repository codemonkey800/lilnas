'use server'

import {
  deleteApiV3MovieById,
  deleteApiV3MoviefileById,
  deleteApiV3QueueById,
  getApiV3MovieById,
  getApiV3MovieLookupTmdb,
  getApiV3Qualityprofile,
  getApiV3Rootfolder,
  type MovieResource,
  postApiV3Command,
  postApiV3Movie,
  postApiV3Release,
  putApiV3MovieById,
  type ReleaseResource,
} from '@lilnas/media/radarr-next'
import { revalidatePath } from 'next/cache'

import {
  getRadarrClient,
  type MovieRelease,
  searchMovieReleases,
} from 'src/media'

function moviesSearchBody(movieIds: number[]) {
  return { name: 'MoviesSearch', movieIds } as Record<string, unknown>
}

export async function triggerMovieDownload(movieId: number, tmdbId: number) {
  const client = getRadarrClient()
  await setMovieMonitored(movieId, true, tmdbId)
  await postApiV3Command({
    client,
    body: moviesSearchBody([movieId]),
  })
  revalidatePath(`/movie/${tmdbId}`)
}

export async function cancelDownload(queueId: number, tmdbId: number) {
  const client = getRadarrClient()
  await deleteApiV3QueueById({
    client,
    path: { id: queueId },
    query: { removeFromClient: true, blocklist: false },
  })
  revalidatePath(`/movie/${tmdbId}`)
}

export async function deleteMovieFile(movieFileId: number, tmdbId: number) {
  const client = getRadarrClient()
  await deleteApiV3MoviefileById({ client, path: { id: movieFileId } })
  revalidatePath(`/movie/${tmdbId}`)
}

export async function searchReleases(movieId: number): Promise<MovieRelease[]> {
  return searchMovieReleases(movieId)
}

export async function grabRelease(
  guid: string,
  indexerId: number,
  tmdbId: number,
) {
  const client = getRadarrClient()
  await postApiV3Release({
    client,
    body: { guid, indexerId } as ReleaseResource,
  })
  revalidatePath(`/movie/${tmdbId}`)
}

export async function setMovieMonitored(
  movieId: number,
  monitored: boolean,
  tmdbId: number,
) {
  const client = getRadarrClient()
  const result = await getApiV3MovieById({ client, path: { id: movieId } })
  const movie = result.data as MovieResource
  await putApiV3MovieById({
    client,
    path: { id: String(movieId) },
    body: { ...movie, monitored },
  })
  revalidatePath(`/movie/${tmdbId}`)
}

export async function addMovieToLibrary(tmdbId: number): Promise<number> {
  const client = getRadarrClient()

  const [lookupResult, rootFolderResult, qualityProfileResult] =
    await Promise.all([
      getApiV3MovieLookupTmdb({ client, query: { tmdbId } }),
      getApiV3Rootfolder({ client }),
      getApiV3Qualityprofile({ client }),
    ])

  const movie = lookupResult.data as MovieResource
  const rootFolders = rootFolderResult.data as Array<{ path?: string | null }>
  const qualityProfiles = qualityProfileResult.data as Array<{ id?: number }>

  const rootFolderPath = rootFolders[0]?.path ?? '/movies'
  const qualityProfileId = qualityProfiles[0]?.id ?? 1

  const result = await postApiV3Movie({
    client,
    body: {
      ...movie,
      rootFolderPath,
      qualityProfileId,
      monitored: false,
      addOptions: { searchForMovie: false },
    } as MovieResource,
  })

  const created = result.data as MovieResource
  return created.id ?? 0
}

export async function removeMovieFromLibrary(
  movieId: number,
  tmdbId: number | null,
) {
  const client = getRadarrClient()
  await deleteApiV3MovieById({
    client,
    path: { id: movieId },
    query: { deleteFiles: true, addImportExclusion: false },
  })
  if (tmdbId) {
    revalidatePath(`/movie/${tmdbId}`)
  }
}
