import { BotSettings } from 'src/components/BotSettings/BotSettings'
import { Messages } from 'src/components/Messages/Messages'

export const dynamic = 'force-dynamic'

export default function MessagesPage() {
  return (
    <div className="flex flex-col gap-4">
      <BotSettings />
      <Messages />
    </div>
  )
}
