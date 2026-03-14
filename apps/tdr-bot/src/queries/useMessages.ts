'use client'

import { useQuery } from '@tanstack/react-query'

import { ApiClient } from 'src/api/api.client'

const apiClient = new ApiClient()

export function useMessages() {
  return useQuery({
    queryKey: ['messages'],
    queryFn: () => apiClient.getMessages(),
    refetchInterval: 5000, // Refetch every 5 seconds for live updates
  })
}
