'use client'

import { useMutation } from '@tanstack/react-query'

import { ApiClient } from 'src/api/api.client'

const apiClient = new ApiClient()

export function useSendMessage() {
  return useMutation({
    mutationFn: ({
      channelId,
      content,
    }: {
      channelId: string
      content: string
    }) => apiClient.sendMessage(channelId, content),
  })
}
