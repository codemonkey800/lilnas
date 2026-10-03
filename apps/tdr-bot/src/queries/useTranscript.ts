'use client'

import { useQuery } from '@tanstack/react-query'

import { ApiClient } from 'src/api/api.client'

const apiClient = new ApiClient()

export function useTranscriptChannels() {
  return useQuery({
    queryKey: ['transcript', 'channels'],
    queryFn: () => apiClient.getTranscriptChannels(),
  })
}

export function useTranscript(
  channelId: string | undefined,
  range: { from?: string; to?: string },
) {
  return useQuery({
    queryKey: ['transcript', channelId, range.from, range.to],
    queryFn: () => apiClient.getTranscript(channelId as string, range),
    enabled: !!channelId,
  })
}
