'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiClient } from 'src/api/api.client'
import type {
  CreateReminderBody,
  ReminderFilter,
  ScheduleBody,
  UpdateReminderBody,
} from 'src/api/api.types'

const apiClient = new ApiClient()

const REMINDERS_KEY = ['reminders'] as const

export function useReminders(filter: ReminderFilter) {
  return useQuery({
    queryKey: [...REMINDERS_KEY, filter],
    queryFn: () => apiClient.getReminders(filter),
  })
}

export function useCreateReminder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: CreateReminderBody) => apiClient.createReminder(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: REMINDERS_KEY }),
  })
}

export function useUpdateReminder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateReminderBody }) =>
      apiClient.updateReminder(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: REMINDERS_KEY }),
  })
}

export function useCancelReminder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiClient.cancelReminder(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: REMINDERS_KEY }),
  })
}

/** Next runs for a schedule; pass null while the schedule is incomplete. */
export function useReminderPreview(schedule: ScheduleBody | null) {
  return useQuery({
    queryKey: ['reminder-preview', schedule],
    queryFn: () => apiClient.previewReminder(schedule as ScheduleBody),
    enabled: schedule !== null,
    retry: false,
  })
}
