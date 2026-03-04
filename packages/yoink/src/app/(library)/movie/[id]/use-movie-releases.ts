'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { MovieRelease } from 'src/media'

import { grabRelease, searchReleases } from './actions'

interface UseMovieReleasesResult {
  releases: MovieRelease[] | null
  isLoading: boolean
  refresh: () => void
}

export function useMovieReleases(movieId: number): UseMovieReleasesResult {
  const {
    data: releases = null,
    isLoading,
    refetch,
  } = useQuery<MovieRelease[]>({
    queryKey: ['movie-releases', movieId],
    queryFn: () => searchReleases(movieId),
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

interface UseGrabReleaseResult {
  mutate: (variables: GrabVariables) => void
  isPending: boolean
  variables: GrabVariables | undefined
}

export function useGrabRelease(
  movieId: number,
  tmdbId: number,
): UseGrabReleaseResult {
  const queryClient = useQueryClient()
  const { mutate, isPending, variables } = useMutation({
    mutationFn: ({ guid, indexerId }: GrabVariables) =>
      grabRelease(guid, indexerId, tmdbId),
    onMutate: () => {
      queryClient.setQueryData(['download-initiated', movieId], true)
    },
    onError: () => {
      queryClient.setQueryData(['download-initiated', movieId], false)
    },
  })
  return { mutate, isPending, variables }
}
