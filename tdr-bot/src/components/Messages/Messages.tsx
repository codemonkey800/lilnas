import { ApiClient } from 'src/api/api.client'

import { MessageCard } from './MessageCard'

const apiClient = ApiClient.getInstance()

export async function Messages() {
  const messages = await apiClient.getMessages()

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 && (
        <div className="flex items-center justify-center h-[30vh]">
          <p className="text-4xl font-medium w-full text-center">
            no messages 😭
          </p>
        </div>
      )}

      {messages.map((message) => (
        <MessageCard
          key={message.id ?? JSON.stringify(message.content)}
          message={message}
        />
      ))}
    </div>
  )
}
