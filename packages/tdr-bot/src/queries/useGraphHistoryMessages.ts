'use client'

import { useQuery } from '@tanstack/react-query'

import { ApiClient } from 'src/api/api.client'

const apiClient = new ApiClient()

export function useGraphHistoryMessages(filename: string | undefined) {
  return useQuery({
    queryKey: ['graph-history-messages', filename],
    queryFn: () => apiClient.getGraphHistoryMessages(filename!),
    enabled: !!filename, // Only fetch when filename is provided
    staleTime: Infinity, // Historical data never goes stale
  })
}
