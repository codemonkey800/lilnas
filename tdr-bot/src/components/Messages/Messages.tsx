import { ApiClient } from 'src/api/api.client'

import { MessageCard } from './MessageCard'
import { MessageRefresher } from './MessageRefresher'

export async function Messages() {
  const apiClient = ApiClient.getInstance()
  const messages = await apiClient.getMessages()

  return (
    <>
      <MessageRefresher />

      <div className="flex flex-col gap-4">
        {messages.map((message) => (
          <MessageCard
            key={JSON.stringify(message.content)}
            message={message}
          />
        ))}
      </div>
    </>
  )
}
