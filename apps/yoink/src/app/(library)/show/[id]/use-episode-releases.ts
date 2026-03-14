'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { ShowRelease } from 'src/media'

import { grabEpisodeRelease, searchEpisodeReleases } from './actions'

interface UseEpisodeReleasesResult {
  releases: ShowRelease[] | null
  isLoading: boolean
  refresh: () => void
}

export function useEpisodeReleases(
  episodeId: number,
  enabled: boolean,
): UseEpisodeReleasesResult {
  const {
    data: releases = null,
    isLoading,
    refetch,
  } = useQuery<ShowRelease[]>({
    queryKey: ['episode-releases', episodeId],
    queryFn: () => searchEpisodeReleases(episodeId),
    enabled,
  })
  return {
    releases,
    isLoading,
    refresh: () => {
      void refetch()
    },
  }
}

interface GrabVariables {
  guid: string
  indexerId: number
}

interface UseGrabEpisodeReleaseResult {
  mutate: (variables: GrabVariables) => void
  isPending: boolean
  variables: GrabVariables | undefined
}

export function useGrabEpisodeRelease(
  episodeId: number,
  tvdbId: number,
): UseGrabEpisodeReleaseResult {
  const queryClient = useQueryClient()
  const { mutate, isPending, variables } = useMutation({
    mutationFn: ({ guid, indexerId }: GrabVariables) =>
      grabEpisodeRelease({ guid, indexerId, tvdbId }),
    onMutate: () => {
      queryClient.setQueryData(['episode-download-initiated', episodeId], true)
    },
    onError: () => {
      queryClient.setQueryData(['episode-download-initiated', episodeId], false)
    },
  })
  return { mutate, isPending, variables }
}
