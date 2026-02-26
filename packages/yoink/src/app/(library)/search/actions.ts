'use server'

import {
  type LibraryItem,
  type SearchFilter,
  searchMedia as searchMediaLib,
} from 'src/lib/media'

export async function searchMedia(
  term: string,
  filter: SearchFilter,
): Promise<LibraryItem[]> {
  const trimmed = term.trim()
  if (!trimmed) return []
  return searchMediaLib(trimmed, filter)
}
