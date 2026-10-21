import { BaseMessage, SystemMessage } from '@langchain/core/messages'
import { Injectable } from '@nestjs/common'
import dedent from 'dedent'

import { EmojiDictionaryService } from 'src/emojis/emoji-dictionary.service'
import { SettingsService } from 'src/llm/settings/settings.service'
import {
  EMOJI_PLACEMENT_HINTS,
  formatStyleNote,
  INPUT_FORMAT,
  PERSONA_REMINDER,
  PROMPT_INTRO,
  TDR_SYSTEM_PROMPT_ID,
} from 'src/utils/prompts'

/** How many random dictionary emojis each style note suggests. */
export const STYLE_NOTE_PICKS = 4

/** How many recent bot replies the style note scans for emojis to avoid. */
export const STYLE_NOTE_RECENT_REPLIES = 5

/** Returns a value in [0, 1), like Math.random; injectable for tests. */
export type RandomFn = () => number

/** Up to `count` distinct items, chosen by a partial Fisher-Yates shuffle. */
function sample<T>(items: readonly T[], count: number, random: RandomFn): T[] {
  const pool = [...items]
  const n = Math.min(count, pool.length)
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(random() * (pool.length - i))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, n)
}

@Injectable()
export class PromptService {
  constructor(
    private readonly settings: SettingsService,
    private readonly emojiDictionary: EmojiDictionaryService,
  ) {}

  /**
   * `options.systemPrompt` replaces only the saved `settings.systemPrompt`;
   * the intro, input format, emoji dictionary and persona reminder are
   * always included.
   */
  getSystemPrompt(options: { systemPrompt?: string } = {}): SystemMessage {
    const systemPrompt =
      options.systemPrompt ?? this.settings.get().systemPrompt

    return new SystemMessage({
      id: TDR_SYSTEM_PROMPT_ID,
      content: dedent`
        ${PROMPT_INTRO}

        ${INPUT_FORMAT}

        ${systemPrompt}

        ${this.emojiDictionary.promptText()}

        ${PERSONA_REMINDER}
      `,
    })
  }

  /**
   * A per-turn note placed right before the user's message: a few random
   * dictionary emojis to try, the ones `history` used recently and a random
   * placement hint. The models in use ignore temperature, so this is where a
   * chat reply's emoji variety comes from. Null when the dictionary is empty.
   * It sits after the history so the cached prompt prefix stays stable.
   */
  getStyleNote(
    history: readonly BaseMessage[],
    random: RandomFn = Math.random,
  ): SystemMessage | null {
    const names = this.emojiDictionary.names()
    if (names.length === 0) return null

    const recent = this.emojiDictionary.recentlyUsed(
      history,
      STYLE_NOTE_RECENT_REPLIES,
    )
    const avoid = new Set(recent)
    const fresh = names.filter(name => !avoid.has(name))
    const picks = sample(
      fresh.length > 0 ? fresh : names,
      STYLE_NOTE_PICKS,
      random,
    )
    const [placement] = sample(EMOJI_PLACEMENT_HINTS, 1, random)

    return new SystemMessage(formatStyleNote({ picks, recent, placement }))
  }
}
