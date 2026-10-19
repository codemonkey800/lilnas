'use client'

import Box from '@mui/material/Box'
import type { SxProps, Theme } from '@mui/material/styles'
import Typography, { type TypographyProps } from '@mui/material/Typography'
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
  sx?: SxProps<Theme>
  variant?: TypographyProps['variant']
}

const cdnUrl = (emoji: CustomEmojiRef) =>
  `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`

function UnknownEmoji({ emoji }: { emoji: CustomEmojiRef }) {
  return (
    <Box
      component="span"
      title="Not in the emoji dictionary"
      sx={{
        display: 'inline-block',
        px: 0.5,
        borderRadius: 1,
        outline: 1,
        outlineStyle: 'dashed',
        outlineColor: 'error.main',
        fontFamily: 'monospace',
        fontSize: '0.85em',
        lineHeight: 1.6,
      }}
    >
      {emoji.raw}
    </Box>
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
    <Box
      component="img"
      src={known?.imageUrl ?? cdnUrl(emoji)}
      alt={`:${emoji.name}:`}
      title={emoji.raw}
      loading="lazy"
      onError={() => setFailed(true)}
      sx={{
        height: '1.375em',
        width: 'auto',
        verticalAlign: 'middle',
        opacity: known?.deletedAt ? 0.5 : 1,
      }}
    />
  )
}

/** Discord message text with custom emoji tokens rendered as images. */
export function DiscordContent({
  text,
  lookup,
  sx,
  variant = 'body2',
}: DiscordContentProps) {
  const segments = segmentCustomEmojis(text)

  return (
    <Typography
      variant={variant}
      sx={[
        { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {segments.map((segment, i) =>
        segment.kind === 'text' ? (
          segment.text
        ) : (
          <CustomEmoji key={i} emoji={segment.emoji} lookup={lookup} />
        ),
      )}
    </Typography>
  )
}
