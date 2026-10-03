'use client'

import { useQuery } from '@tanstack/react-query'

import { ApiClient } from 'src/api/api.client'
import type { ModelRole } from 'src/llm/models/roles'

const apiClient = new ApiClient()

export function useModels(role: ModelRole) {
  return useQuery({
    queryKey: ['models', role],
    queryFn: () => apiClient.getModels(role),
    staleTime: 5 * 60 * 1000, // the catalog is static per deploy
  })
}
