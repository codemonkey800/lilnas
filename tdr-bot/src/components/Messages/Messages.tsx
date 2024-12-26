import { MessageCard } from './MessageCard'
import { MOCK_MESSAGES } from './messages'

// const apiClient = ApiClient.getInstance()

export async function Messages() {
  // const messages = await apiClient.getMessages()
  // const messages = await apiClient.getMessages()
  const messages = MOCK_MESSAGES

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
