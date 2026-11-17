'use client'

import { Icon } from '@lilnas/ui'

import { DiscordContent } from 'src/components/DiscordContent'
import type { EmojiLookup } from 'src/queries/useEmojiLookup'

import type { TranscriptItem } from './group-turns'
import { LlmCalls } from './llm-calls'

/** A tool call between turns: dashed, collapsed, the arguments one click away. */
function ToolRow({ name, detail }: { name: string; detail: string }) {
  return (
    <details className="group ml-4 min-w-0 rounded-lg border border-dashed border-line text-cap text-ink-3 md:ml-10">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 [&::-webkit-details-marker]:hidden">
        <Icon
          className="-rotate-90 transition-transform duration-200 ease-standard group-open:rotate-0"
          name="chevron"
          size={12}
        />
        <span className="font-mono text-mono-sm text-accent-hi">{name}</span>
      </summary>
      <pre className="overflow-x-auto px-3 pb-2 font-mono text-mono-sm text-ink-2">
        {detail}
      </pre>
    </details>
  )
}

/** One item of the thread: a person's message, a tool call or a bot reply. */
export function TranscriptTurn({
  item,
  lookup,
}: {
  item: TranscriptItem
  lookup: EmojiLookup
}) {
  if (item.kind === 'tool') {
    return <ToolRow detail={item.detail} name={item.name} />
  }

  if (item.kind === 'human') {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[90%] flex-col gap-1 rounded-xl rounded-br-xs bg-accent-ghost px-3.5 py-2.5 md:max-w-[72%]">
          <span className="text-cap font-medium text-accent-hi">
            {item.message.name ?? 'user'}
          </span>
          <DiscordContent lookup={lookup} text={item.message.content} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex">
      <div className="flex w-full min-w-0 flex-col md:max-w-[80%] md:flex-1">
        <div className="flex flex-col gap-1 rounded-xl rounded-bl-xs border border-line bg-surface px-3.5 py-2.5">
          <span className="text-cap font-medium text-ink-3">tdr-bot</span>
          <DiscordContent lookup={lookup} text={item.message.content} />
        </div>
        {item.calls.length > 0 && <LlmCalls calls={item.calls} />}
      </div>
    </div>
  )
}
