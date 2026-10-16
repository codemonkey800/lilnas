import { emojis } from 'src/utils/emojis'

const EMOJI_KEY = /^<a?:([^:]+):(\d+)>$/

/**
 * The hand-written descriptions of the old static dictionary, keyed by emoji
 * id. The only importer of `src/utils/emojis.ts`, so deleting that file
 * touches just this one.
 */
export function seedDescriptions(): Map<string, string> {
  const seeds = new Map<string, string>()
  for (const [key, description] of Object.entries(emojis)) {
    const match = EMOJI_KEY.exec(key)
    if (match) seeds.set(match[2], description)
  }
  return seeds
}
