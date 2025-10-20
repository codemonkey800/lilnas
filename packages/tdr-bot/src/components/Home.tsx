import { MessageHistory } from 'src/components/MessageHistory'
import { SendMessage } from 'src/components/SendMessage'

export function Home() {
  return (
    <div className="container mx-auto p-4 md:p-6 max-w-4xl space-y-6">
      <SendMessage />
      <MessageHistory />
    </div>
  )
}
