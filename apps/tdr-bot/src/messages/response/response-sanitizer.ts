import { Injectable } from '@nestjs/common'
import { remark } from 'remark'

import { remarkFixLinkPlugin } from 'src/utils/fix-link'

/**
 * Discord tokens that open with '<' + a letter, which remark escapes to '\<'
 * as if they started an HTML tag: animated emoji '<a:name:id>' and timestamps
 * '<t:unix>' / '<t:unix:R>'. Static emoji and mentions start with ':', '@' or
 * '#' and pass through untouched.
 */
const ESCAPED_DISCORD_TOKEN_RE =
  /\\(<a:[A-Za-z0-9_]{2,32}:\d{17,20}>|<t:-?\d+(?::[tTdDfFR])?>)/g

/** Drops the '\' remark puts before Discord tokens so they render. */
export function unescapeDiscordTokens(markdown: string): string {
  return markdown.replace(ESCAPED_DISCORD_TOKEN_RE, '$1')
}

@Injectable()
export class ResponseSanitizer {
  async sanitizeResponse(content: string): Promise<string> {
    const result = await remark().use(remarkFixLinkPlugin).process(content)
    return unescapeDiscordTokens(result.toString())
  }
}
