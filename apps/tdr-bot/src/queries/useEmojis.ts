'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiClient } from 'src/api/api.client'

const apiClient = new ApiClient()

const EMOJIS_KEY = ['emojis'] as const

const RECONCILE_POLL_MS = 3000

/** The dictionary; polls while a reconcile is running. */
export function useEmojis() {
  return useQuery({
    queryKey: EMOJIS_KEY,
    queryFn: () => apiClient.getEmojis(),
    refetchInterval: query =>
      query.state.data?.reconcile.running ? RECONCILE_POLL_MS : false,
  })
}

/** Saves a hand-written description (stored as manual). */
export function useUpdateEmoji() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, description }: { id: string; description: string }) =>
      apiClient.updateEmoji(id, { description }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EMOJIS_KEY }),
  })
}

export function useRedescribeEmoji() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.redescribeEmoji(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EMOJIS_KEY }),
  })
}

export function useReconcileEmojis() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => apiClient.reconcileEmojis(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EMOJIS_KEY }),
  })
}

export function useRedescribeAllEmojis() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => apiClient.redescribeAllEmojis(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EMOJIS_KEY }),
  })
}
