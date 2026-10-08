'use client'

import { useQuery } from '@tanstack/react-query'

import { ApiClient } from 'src/api/api.client'

const apiClient = new ApiClient()

export function useMembers() {
  return useQuery({
    queryKey: ['members'],
    queryFn: () => apiClient.getMembers(),
    staleTime: 5 * 60 * 1000, // 5 minutes - guild members don't change often
  })
}
