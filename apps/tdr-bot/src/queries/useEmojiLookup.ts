'use client'

import { useMemo } from 'react'

import type { EmojiView } from 'src/api/api.types'

import { useEmojis } from './useEmojis'

export interface EmojiLookup {
  /** Every dictionary row (deleted ones included) keyed by Discord emoji id. */
  byId: Map<string, EmojiView>
  isLoading: boolean
}

/** The emoji dictionary indexed by id, for rendering Discord content. */
export function useEmojiLookup(): EmojiLookup {
  const { data, isLoading } = useEmojis()

  return useMemo(
    () => ({
      byId: new Map((data?.emojis ?? []).map(emoji => [emoji.id, emoji])),
      isLoading,
    }),
    [data, isLoading],
  )
}
