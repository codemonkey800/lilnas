import { ApiClient } from 'src/api/api.client'

import { MessageCard } from './MessageCard'

const apiClient = ApiClient.getInstance()

export async function Messages() {
  const messages = await apiClient.getMessages()

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
