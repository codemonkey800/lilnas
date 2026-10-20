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
  { kind: 'text'; text: string } | { kind: 'emoji'; emoji: CustomEmojiRef }

export interface EmojiAnalysis {
  counts: {
    dictionary: number
    repaired: number
    hallucinated: number
    unicode: number
  }
  /** Refs sent as written. */
  dictionary: ResolvedEmoji[]
  /** Refs with a wrong id, animated flag, case or name, fixed before send. */
  repaired: ResolvedEmoji[]
  /** Refs the dictionary cannot explain, stripped before send. */
  hallucinated: ResolvedEmoji[]
  /** Each matched unicode emoji sequence, in order. */
  unicode: string[]
}

/** Discord custom emoji token: '<:name:id>' or '<a:name:id>'. */
const CUSTOM_EMOJI_RE = /<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>/g
/** A whole string that is exactly one custom emoji token (a dictionary key). */
const CUSTOM_EMOJI_KEY_RE = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/

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

export type EmojiFix = 'id' | 'animated' | 'case' | 'name'

export interface ResolvedEmoji {
  /** As written: ':name:' or '<a?:name:id>'. */
  raw: string
  form: 'shortcode' | 'token'
  /** Name as written. */
  name: string
  /** Offsets of `raw` in the input. */
  start: number
  end: number
  /** Canonical emojiKey sent instead; null = dropped. */
  key: string | null
  status: 'dictionary' | 'repaired' | 'dropped'
  /** [] unless status is 'repaired'. */
  fixes: EmojiFix[]
}

export interface EmojiResolution {
  text: string
  emojis: ResolvedEmoji[]
}

/**
 * ':name:' whose colons are not adjacent to another ':' or a word character,
 * so '12:30:45', 'https://x' and '<:EZ:1>' are left alone. Any name shape is
 * matched; a digit/underscore-first name is a ref only when it is in the
 * dictionary (':50:' stays text, ':5Head:' resolves). A '<:name:>' (the token
 * format with its id left off) matches whole, so the brackets go with it.
 */
const ANY_SHORTCODE_RE =
  /<:([A-Za-z0-9_]{2,32}):>|(?<![:\w]):([A-Za-z0-9_]{2,32}):(?![:\w])/g
/** Letter-first names: unknown names of this shape are dropped, others stay text. */
const SHORTCODE_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{1,31}$/
/** Fenced code blocks and inline code spans, copied through untouched. */
const CODE_RE = /```[\s\S]*?```|`[^`\n]+`/g

interface DictionaryEntry {
  key: string
  name: string
  id: string
  animated: boolean
}

interface ResolverDictionary {
  byKey: Map<string, DictionaryEntry>
  byName: Map<string, DictionaryEntry>
  byLower: Map<string, DictionaryEntry>
  byId: Map<string, DictionaryEntry>
}

/** Keeps the entry with the largest snowflake, regardless of key order. */
function setNewest(
  map: Map<string, DictionaryEntry>,
  name: string,
  entry: DictionaryEntry,
): void {
  const current = map.get(name)
  if (!current || BigInt(entry.id) > BigInt(current.id)) map.set(name, entry)
}

function parseResolverDictionary(keys: Iterable<string>): ResolverDictionary {
  const dictionary: ResolverDictionary = {
    byKey: new Map(),
    byName: new Map(),
    byLower: new Map(),
    byId: new Map(),
  }
  for (const key of keys) {
    const match = CUSTOM_EMOJI_KEY_RE.exec(key)
    if (!match) continue
    const ref = parseCustomEmoji(match, 0)
    const entry: DictionaryEntry = {
      key: ref.raw,
      name: ref.name,
      id: ref.id,
      animated: ref.animated,
    }
    dictionary.byKey.set(entry.key, entry)
    setNewest(dictionary.byName, entry.name, entry)
    setNewest(dictionary.byLower, entry.name.toLowerCase(), entry)
    if (!dictionary.byId.has(entry.id)) dictionary.byId.set(entry.id, entry)
  }
  return dictionary
}

type Resolution = Pick<ResolvedEmoji, 'key' | 'status' | 'fixes'>

function resolveShortcode(
  name: string,
  dictionary: ResolverDictionary,
): Resolution | null {
  const exact = dictionary.byName.get(name)
  if (exact) return { key: exact.key, status: 'dictionary', fixes: [] }
  const lower = dictionary.byLower.get(name.toLowerCase())
  if (lower) return { key: lower.key, status: 'repaired', fixes: ['case'] }
  if (SHORTCODE_NAME_RE.test(name)) {
    return { key: null, status: 'dropped', fixes: [] }
  }
  return null
}

function resolveToken(
  ref: CustomEmojiRef,
  dictionary: ResolverDictionary,
): Resolution {
  if (dictionary.byKey.has(ref.raw)) {
    return { key: ref.raw, status: 'dictionary', fixes: [] }
  }
  const byName =
    dictionary.byName.get(ref.name) ??
    dictionary.byLower.get(ref.name.toLowerCase())
  if (byName) {
    const fixes: EmojiFix[] = []
    if (byName.name !== ref.name) fixes.push('case')
    if (byName.id !== ref.id) fixes.push('id')
    if (byName.animated !== ref.animated) fixes.push('animated')
    return { key: byName.key, status: 'repaired', fixes }
  }
  const byId = dictionary.byId.get(ref.id)
  if (byId) {
    const fixes: EmojiFix[] = ['name']
    if (byId.animated !== ref.animated) fixes.push('animated')
    return { key: byId.key, status: 'repaired', fixes }
  }
  return { key: null, status: 'dropped', fixes: [] }
}

/**
 * Accumulates the output text. A dropped ref deletes itself and collapses the
 * spaces/tabs around it to one space, trimmed away at the start or end of a
 * line; newlines are never removed.
 */
class OutputBuilder {
  private text = ''
  private dropped = false
  private removedSpace = false

  append(piece: string): void {
    if (!this.dropped) {
      this.text += piece
      return
    }
    const stripped = piece.replace(/^[ \t]+/, '')
    if (stripped.length < piece.length) this.removedSpace = true
    if (stripped === '') return
    this.dropped = false
    const atLineStart = this.text === '' || this.text.endsWith('\n')
    if (this.removedSpace && !atLineStart && !stripped.startsWith('\n')) {
      this.text += ' '
    }
    this.text += stripped
  }

  drop(): void {
    const trimmed = this.text.replace(/[ \t]+$/, '')
    if (!this.dropped) this.removedSpace = false
    if (trimmed.length < this.text.length) this.removedSpace = true
    this.text = trimmed
    this.dropped = true
  }

  toString(): string {
    return this.text
  }
}

/**
 * Rewrites ':name:' shortcodes and '<a?:name:id>' tokens to the dictionary's
 * canonical keys, repairing case, id, animated flag and (by id) name, and
 * dropping refs the dictionary cannot explain. Code spans and fences are left
 * untouched. Resolving already-resolved text is a no-op.
 */
export function resolveEmojis(
  text: string,
  dictionaryKeys: Iterable<string>,
): EmojiResolution {
  const dictionary = parseResolverDictionary(dictionaryKeys)
  const output = new OutputBuilder()
  const emojis: ResolvedEmoji[] = []

  const emit = (
    resolution: Resolution,
    ref: Omit<ResolvedEmoji, keyof Resolution>,
  ): void => {
    emojis.push({ ...ref, ...resolution })
    if (resolution.key === null) output.drop()
    else output.append(resolution.key)
  }

  const resolveRun = (run: string, offset: number): void => {
    let cursor = 0
    for (const match of run.matchAll(ANY_SHORTCODE_RE)) {
      const raw = match[0]
      const name = match[1] ?? match[2]
      const resolution = resolveShortcode(name, dictionary)
      if (!resolution) continue
      const start = match.index ?? 0
      output.append(run.slice(cursor, start))
      emit(resolution, {
        raw,
        form: 'shortcode',
        name,
        start: offset + start,
        end: offset + start + raw.length,
      })
      cursor = start + raw.length
    }
    output.append(run.slice(cursor))
  }

  const resolveProse = (prose: string, offset: number): void => {
    let cursor = 0
    for (const segment of segmentCustomEmojis(prose)) {
      if (segment.kind === 'text') {
        resolveRun(segment.text, offset + cursor)
        cursor += segment.text.length
        continue
      }
      const { emoji } = segment
      emit(resolveToken(emoji, dictionary), {
        raw: emoji.raw,
        form: 'token',
        name: emoji.name,
        start: offset + emoji.start,
        end: offset + emoji.end,
      })
      cursor = emoji.end
    }
  }

  let cursor = 0
  for (const match of text.matchAll(CODE_RE)) {
    const start = match.index ?? 0
    resolveProse(text.slice(cursor, start), cursor)
    output.append(match[0])
    cursor = start + match[0].length
  }
  resolveProse(text.slice(cursor), cursor)

  return { text: output.toString(), emojis }
}

/**
 * The runs of `text` outside code spans/fences and outside resolved refs, in
 * order. Unicode emoji are counted per run so a sequence never spans a ref.
 */
function proseRuns(text: string, emojis: ResolvedEmoji[]): string[] {
  const spans = [
    ...[...text.matchAll(CODE_RE)].map(match => {
      const start = match.index ?? 0
      return { start, end: start + match[0].length }
    }),
    ...emojis.map(({ start, end }) => ({ start, end })),
  ].sort((a, b) => a.start - b.start)

  const runs: string[] = []
  let cursor = 0
  for (const span of spans) {
    if (span.start > cursor) runs.push(text.slice(cursor, span.start))
    cursor = span.end
  }
  if (cursor < text.length) runs.push(text.slice(cursor))
  return runs
}

/**
 * Scores the raw model output by what `resolveEmojis` does to each ref:
 * dictionary refs are sent as written, repaired ones are fixed, hallucinated
 * ones are dropped. Unicode emoji are counted in the prose between them.
 */
export function analyzeEmojis(
  raw: string,
  dictionaryKeys: Iterable<string>,
): EmojiAnalysis {
  const { emojis } = resolveEmojis(raw, dictionaryKeys)
  const dictionary = emojis.filter(e => e.status === 'dictionary')
  const repaired = emojis.filter(e => e.status === 'repaired')
  const hallucinated = emojis.filter(e => e.status === 'dropped')
  const unicode = proseRuns(raw, emojis).flatMap(run =>
    [...run.matchAll(UNICODE_EMOJI_RE)].map(match => match[0]),
  )

  return {
    counts: {
      dictionary: dictionary.length,
      repaired: repaired.length,
      hallucinated: hallucinated.length,
      unicode: unicode.length,
    },
    dictionary,
    repaired,
    hallucinated,
    unicode,
  }
}

/** '5 dictionary · 1 repaired · 1 hallucinated · 2 unicode' */
export function formatEmojiScore(counts: EmojiAnalysis['counts']): string {
  return [
    `${counts.dictionary} dictionary`,
    `${counts.repaired} repaired`,
    `${counts.hallucinated} hallucinated`,
    `${counts.unicode} unicode`,
  ].join(' · ')
}
