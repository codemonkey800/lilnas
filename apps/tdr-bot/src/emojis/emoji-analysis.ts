/**
 * Pure helpers for tokenizing and scoring emoji usage in a reply. Imported by
 * both the Nest backend and the Next.js client bundle, so this module must
 * stay free of Nest, Node and discord.js imports.
 */

export interface CustomEmojiRef {
  /** The token as written, e.g. '<a:peepoWine:1266528661318926369>'. */
  raw: string
  name: string
  id: string
  animated: boolean
  /** Offset of `raw` in the input. */
  start: number
  end: number
}

export type ContentSegment =
  | { kind: 'text'; text: string }
  | { kind: 'emoji'; emoji: CustomEmojiRef }

export type HallucinationReason =
  | 'unknown'
  | 'name-mismatch'
  | 'animated-mismatch'

export interface EmojiAnalysis {
  counts: {
    dictionary: number
    hallucinated: number
    unicode: number
    shortcode: number
  }
  dictionary: CustomEmojiRef[]
  hallucinated: (CustomEmojiRef & { reason: HallucinationReason })[]
  /** Each matched unicode emoji sequence, in order. */
  unicode: string[]
  /** Bare ':name:' occurrences, name only. */
  shortcodes: string[]
}

/** Discord custom emoji token: '<:name:id>' or '<a:name:id>'. */
const CUSTOM_EMOJI_RE = /<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>/g
/** A whole string that is exactly one custom emoji token (a dictionary key). */
const CUSTOM_EMOJI_KEY_RE = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/

/**
 * ':name:' whose colons are not adjacent to another ':' or a word character,
 * so '12:30:45', 'https://x' and '<:EZ:1>' are left alone.
 */
const SHORTCODE_RE = /(?<![:\w]):([A-Za-z][A-Za-z0-9_]{1,31}):(?![:\w])/g

/**
 * A pictograph with optional skin-tone modifiers / VS16, extended by any
 * number of ZWJ-joined pictographs, or a regional-indicator pair (a flag).
 * ©, ® and ™ carry Extended_Pictographic but are ordinary text here.
 */
const PICTOGRAPH = '\\p{Extended_Pictographic}(?:\\p{Emoji_Modifier}|\\uFE0F)*'
const UNICODE_EMOJI_RE = new RegExp(
  `\\p{Regional_Indicator}{2}|(?![\\u00A9\\u00AE\\u2122])${PICTOGRAPH}(?:\\u200D${PICTOGRAPH})*`,
  'gu',
)

function parseCustomEmoji(
  match: RegExpMatchArray,
  start: number,
): CustomEmojiRef {
  const [raw, animated, name, id] = match
  return {
    raw,
    name,
    id,
    animated: animated === 'a',
    start,
    end: start + raw.length,
  }
}

/** Splits text into plain runs and custom-emoji tokens, in order; no empty text runs. */
export function segmentCustomEmojis(text: string): ContentSegment[] {
  const segments: ContentSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(CUSTOM_EMOJI_RE)) {
    const start = match.index ?? 0
    if (start > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, start) })
    }
    const emoji = parseCustomEmoji(match, start)
    segments.push({ kind: 'emoji', emoji })
    cursor = emoji.end
  }
  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) })
  }
  return segments
}

interface Dictionary {
  raws: Set<string>
  byId: Map<string, { name: string; animated: boolean }>
}

/** Parses prompt keys with the token regex; keys that don't parse are ignored. */
function parseDictionary(keys: Iterable<string>): Dictionary {
  const raws = new Set<string>()
  const byId = new Map<string, { name: string; animated: boolean }>()
  for (const key of keys) {
    const match = CUSTOM_EMOJI_KEY_RE.exec(key)
    if (!match) continue
    const ref = parseCustomEmoji(match, 0)
    raws.add(ref.raw)
    if (!byId.has(ref.id)) {
      byId.set(ref.id, { name: ref.name, animated: ref.animated })
    }
  }
  return { raws, byId }
}

function hallucinationReason(
  ref: CustomEmojiRef,
  dictionary: Dictionary,
): HallucinationReason {
  const known = dictionary.byId.get(ref.id)
  if (!known) return 'unknown'
  if (known.name !== ref.name) return 'name-mismatch'
  return 'animated-mismatch'
}

/** dictionaryKeys are the prompt's keys: '<:name:id>' / '<a:name:id>'. */
export function analyzeEmojis(
  text: string,
  dictionaryKeys: Iterable<string>,
): EmojiAnalysis {
  const dictionary = parseDictionary(dictionaryKeys)
  const analysis: EmojiAnalysis = {
    counts: { dictionary: 0, hallucinated: 0, unicode: 0, shortcode: 0 },
    dictionary: [],
    hallucinated: [],
    unicode: [],
    shortcodes: [],
  }

  for (const segment of segmentCustomEmojis(text)) {
    if (segment.kind === 'emoji') {
      const { emoji } = segment
      if (dictionary.raws.has(emoji.raw)) {
        analysis.dictionary.push(emoji)
      } else {
        analysis.hallucinated.push({
          ...emoji,
          reason: hallucinationReason(emoji, dictionary),
        })
      }
      continue
    }
    for (const match of segment.text.matchAll(SHORTCODE_RE)) {
      analysis.shortcodes.push(match[1])
    }
    for (const match of segment.text.matchAll(UNICODE_EMOJI_RE)) {
      analysis.unicode.push(match[0])
    }
  }

  analysis.counts = {
    dictionary: analysis.dictionary.length,
    hallucinated: analysis.hallucinated.length,
    unicode: analysis.unicode.length,
    shortcode: analysis.shortcodes.length,
  }
  return analysis
}

/** '5 dictionary · 1 hallucinated · 2 unicode · 0 shortcode' */
export function formatEmojiScore(counts: EmojiAnalysis['counts']): string {
  return [
    `${counts.dictionary} dictionary`,
    `${counts.hallucinated} hallucinated`,
    `${counts.unicode} unicode`,
    `${counts.shortcode} shortcode`,
  ].join(' · ')
}
