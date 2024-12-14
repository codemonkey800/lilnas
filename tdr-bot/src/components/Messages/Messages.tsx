'use client'

import { useQuery } from '@tanstack/react-query'

import { ApiClient } from 'src/api/api.client'

import { MessageCard } from './MessageCard'

const apiClient = ApiClient.getInstance()

export async function Messages() {
  const { data: messages = [] } = useQuery({
    queryKey: ['messages'],
    queryFn: () => apiClient.getMessages(),
    refetchInterval: 2000,
  })

  return (
    <div className="flex flex-col gap-4">
      {messages.map((message) => (
        <MessageCard
          key={message.id ?? JSON.stringify(message.content)}
          message={message}
        />
      ))}
    </div>
  )
}
