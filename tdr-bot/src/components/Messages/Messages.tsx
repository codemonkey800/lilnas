'use client'

import { useEffect, useState } from 'react'

import { ApiClient } from 'src/api/api.client'
import { MessageState } from 'src/api/api.types'

import { MessageCard } from './MessageCard'

export async function Messages() {
  const [messages, setMessages] = useState<MessageState[]>([])

  useEffect(() => {
    async function fetchMessages() {
      const apiClient = ApiClient.getInstance()
      const nextMessages = await apiClient.getMessages()
      setMessages(nextMessages)
    }

    const intervalId = window.setInterval(fetchMessages, 2000)
    return () => window.clearInterval(intervalId)
  })

  return (
    <div className="flex flex-col gap-4">
      {messages.map((message) => (
        <MessageCard key={JSON.stringify(message.content)} message={message} />
      ))}
    </div>
  )
}
