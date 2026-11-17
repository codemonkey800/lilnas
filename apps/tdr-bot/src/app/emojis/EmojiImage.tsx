'use client'

import { PepeBadge } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import { useState } from 'react'

import type { EmojiView } from 'src/api/api.types'

/** The emoji's image on a sunk tile; deleted ones fade, broken ones are the mark. */
export function EmojiImage({
  emoji,
  size = 'md',
}: {
  emoji: EmojiView
  size?: 'md' | 'lg'
}) {
  const [broken, setBroken] = useState(false)
  const label = `:${emoji.name}:`

  return (
    <span
      className={cns(
        'grid shrink-0 place-items-center rounded-md bg-bg-sunk',
        size === 'lg' ? 'size-12' : 'size-10',
        emoji.deletedAt && 'opacity-40',
      )}
    >
      {broken ? (
        <PepeBadge aria-label={label} size={size === 'lg' ? 32 : 24} />
      ) : (
        <img
          alt={label}
          className={cns('object-contain', size === 'lg' ? 'size-9' : 'size-7')}
          src={emoji.imageUrl}
          onError={() => setBroken(true)}
        />
      )}
    </span>
  )
}
