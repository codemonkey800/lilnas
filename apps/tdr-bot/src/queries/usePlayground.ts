'use client'

import { useMutation } from '@tanstack/react-query'

import { ApiClient } from 'src/api/api.client'
import type { PlaygroundChatBody } from 'src/api/api.types'

const apiClient = new ApiClient()

/** One stateless chat call; nothing is cached, so nothing to invalidate. */
export function usePlaygroundChat() {
  return useMutation({
    mutationFn: (body: PlaygroundChatBody) => apiClient.playgroundChat(body),
  })
}
