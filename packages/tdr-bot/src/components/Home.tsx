import { MessageHistory } from 'src/components/MessageHistory'

export function Home() {
  return (
    <div className="container mx-auto p-4 md:p-6 max-w-4xl">
      <MessageHistory />
    </div>
  )
}
