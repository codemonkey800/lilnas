'use client'

import { cns } from '@lilnas/utils/cns'
import { useState } from 'react'

import {
  type CustomEmojiRef,
  segmentCustomEmojis,
} from 'src/emojis/emoji-analysis'
import type { EmojiLookup } from 'src/queries/useEmojiLookup'

export interface DiscordContentProps {
  text: string
  /** When given and loaded, unknown ids render as flagged raw tokens. */
  lookup?: EmojiLookup
  className?: string
}

const cdnUrl = (emoji: CustomEmojiRef) =>
  `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`

function UnknownEmoji({ emoji }: { emoji: CustomEmojiRef }) {
  return (
    <span
      className="inline-flex items-center rounded-xs border border-dashed border-bad px-1 align-middle font-mono text-mono-sm text-bad"
      title="Not in the emoji dictionary"
    >
      {emoji.raw}
    </span>
  )
}

function CustomEmoji({
  emoji,
  lookup,
}: {
  emoji: CustomEmojiRef
  lookup?: EmojiLookup
}) {
  const [failed, setFailed] = useState(false)
  const known = lookup?.byId.get(emoji.id)

  if (failed) return <>{emoji.raw}</>

  if (lookup && !lookup.isLoading && !known) {
    return <UnknownEmoji emoji={emoji} />
  }

  return (
    <img
      alt={`:${emoji.name}:`}
      className={cns(
        'inline-block h-[1.375em] w-auto align-middle',
        known?.deletedAt && 'opacity-50',
      )}
      loading="lazy"
      src={known?.imageUrl ?? cdnUrl(emoji)}
      title={emoji.raw}
      onError={() => setFailed(true)}
    />
  )
}

/** Discord message text with custom emoji tokens rendered as images. */
export function DiscordContent({
  text,
  lookup,
  className,
}: DiscordContentProps) {
  const segments = segmentCustomEmojis(text)

  return (
    <p
      className={cns(
        'text-body wrap-anywhere whitespace-pre-wrap text-ink',
        className,
      )}
    >
      {segments.map((segment, i) =>
        segment.kind === 'text' ? (
          segment.text
        ) : (
          <CustomEmoji key={i} emoji={segment.emoji} lookup={lookup} />
        ),
      )}
    </p>
  )
}
