'use client'

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { ApiClient } from 'src/api/api.client'

const apiClient = new ApiClient()

export function useTranscriptChannels() {
  return useQuery({
    queryKey: ['transcript', 'channels'],
    queryFn: () => apiClient.getTranscriptChannels(),
  })
}

/** The channel's thread in pages, newest page first; `fetchNextPage` loads older. */
export function useTranscript(
  channelId: string | undefined,
  range: { from?: string; to?: string },
) {
  return useInfiniteQuery({
    queryKey: ['transcript', channelId, range.from, range.to],
    queryFn: ({ pageParam }) =>
      apiClient.getTranscript(channelId as string, {
        ...range,
        before: pageParam,
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: last => last.nextCursor ?? undefined,
    enabled: !!channelId,
  })
}
