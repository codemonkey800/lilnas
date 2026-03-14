'use server'

import { revalidatePath } from 'next/cache'

import {
  api,
  type CancelAllShowDownloadsParams,
  type CancelShowQueueItemParams,
  type DeleteEpisodeFileParams,
  type DeleteSeasonFilesParams,
  type GrabEpisodeReleaseParams,
  type RemoveShowFromLibraryParams,
  type SetEpisodeMonitoredParams,
} from 'src/media/api.server'

export async function searchEpisodeReleases(episodeId: number) {
  return api.searchEpisodeReleases(episodeId)
}

export async function addShowToLibrary(tvdbId: number) {
  return api.addShowToLibrary(tvdbId)
}

export async function cancelDownload(params: CancelShowQueueItemParams) {
  await api.cancelShowQueueItem(params)
  revalidatePath(`/show/${params.tvdbId}`)
}

export async function cancelAllShowDownloads(
  params: CancelAllShowDownloadsParams,
): Promise<{ cancelledEpisodeIds: number[] }> {
  const result = await api.cancelAllShowDownloads(params)
  revalidatePath(`/show/${params.tvdbId}`)
  return result
}

export async function deleteEpisodeFile(
  params: DeleteEpisodeFileParams,
): Promise<void> {
  await api.deleteEpisodeFile(params)
  revalidatePath(`/show/${params.tvdbId}`)
}

export async function deleteSeasonFiles(
  params: DeleteSeasonFilesParams,
): Promise<void> {
  await api.deleteSeasonFiles(params)
  revalidatePath(`/show/${params.tvdbId}`)
}

export async function grabEpisodeRelease(
  params: GrabEpisodeReleaseParams,
): Promise<void> {
  await api.grabEpisodeRelease(params)
  revalidatePath(`/show/${params.tvdbId}`)
}

export async function setEpisodeMonitored(
  params: SetEpisodeMonitoredParams,
): Promise<void> {
  await api.setEpisodeMonitored(params)
  revalidatePath(`/show/${params.tvdbId}`)
}

export async function removeShowFromLibrary(
  params: RemoveShowFromLibraryParams,
): Promise<void> {
  await api.removeShowFromLibrary(params)
  revalidatePath(`/show/${params.tvdbId}`)
}
