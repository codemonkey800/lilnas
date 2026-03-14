'use server'

import type { LibraryItem, SearchFilter } from 'src/media'
import { api } from 'src/media/api.server'

export async function searchMedia(
  term: string,
  filter: SearchFilter,
): Promise<LibraryItem[]> {
  const trimmed = term.trim()
  if (!trimmed) return []
  return api.searchMedia({ term: trimmed, filter })
}
