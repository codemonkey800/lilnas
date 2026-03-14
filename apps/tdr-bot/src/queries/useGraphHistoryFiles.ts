'use client'

import { useQuery } from '@tanstack/react-query'

import { ApiClient } from 'src/api/api.client'

const apiClient = new ApiClient()

export function useGraphHistoryFiles() {
  return useQuery({
    queryKey: ['graph-history-files'],
    queryFn: () => apiClient.getGraphHistoryFiles(),
    staleTime: 60000, // Cache for 1 minute
  })
}
