import Avatar from '@mui/material/Avatar'

import type { EmojiView } from 'src/api/api.types'

export function EmojiImage({
  emoji,
  size = 32,
}: {
  emoji: EmojiView
  size?: number
}) {
  return (
    <Avatar
      variant="square"
      src={emoji.imageUrl}
      alt={`:${emoji.name}:`}
      sx={{
        width: size,
        height: size,
        bgcolor: 'transparent',
        flexShrink: 0,
        opacity: emoji.deletedAt ? 0.4 : 1,
        '& img': { objectFit: 'contain' },
      }}
    />
  )
}
