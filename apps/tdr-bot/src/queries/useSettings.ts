'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiClient } from 'src/api/api.client'
import type { SettingsPatch } from 'src/llm/settings/settings.schema'

const apiClient = new ApiClient()

export const SETTINGS_QUERY_KEY = ['settings'] as const

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => apiClient.getSettings(),
  })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (patch: SettingsPatch) => apiClient.updateSettings(patch),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY }),
  })
}

export function useResetSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => apiClient.resetSettings(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY }),
  })
}
