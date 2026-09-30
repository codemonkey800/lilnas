import { HumanMessage } from '@langchain/core/messages'
import { ACTIVITY_HREF, mediaHref } from '@lilnas/utils/download/media-route'
import type { Media } from '@lilnas/utils/download/types'
import { env } from '@lilnas/utils/env'
import { nanoid } from 'nanoid'

import { EnvKeys } from 'src/env'

/**
 * The download site users follow a download on. Defaults to production.
 *
 * Must name the same instance `DOWNLOAD_API_URL` points at: a `/download`
 * job only exists on the instance that created it, so a dev bot creating
 * jobs on the dev container but linking to production would link to pages
 * that 404. Read per call rather than at module load so tests can set it.
 */
function downloadBaseUrl(): string {
  return env(EnvKeys.DOWNLOAD_URL, 'https://download.lilnas.io').replace(
    /\/+$/,
    '',
  )
}

export interface DownloadLinks {
  /** The activity page - every job in flight. */
  activity: string
  /** The title's own detail page. */
  media: string
}

/** Absolute URLs for the activity page and `media`'s detail page. */
export function downloadLinks(
  media: Pick<Media, 'id' | 'type'>,
): DownloadLinks {
  const base = downloadBaseUrl()

  return {
    activity: `${base}${ACTIVITY_HREF}`,
    media: `${base}${mediaHref(media)}`,
  }
}

/**
 * Emoji and the invisible characters that build them (skin tones, flags,
 * keycaps, joiners, variation selectors).
 */
const EMOJI_REGEX =
  /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u200d|\ufe0f|\u20e3/gu

/**
 * Makes `text` safe to use as a Discord masked link's text. Emoji are
 * stripped because Discord shows the whole link as raw markdown when its text
 * contains one, and brackets are escaped so a title like `[REC]` doesn't end
 * the text early.
 */
export function escapeLinkText(text: string): string {
  return text
    .replace(EMOJI_REGEX, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/[[\]\\]/g, '\\$&')
}

/** One option in a list the user picks a title from. */
export interface SelectionListItem {
  media: Pick<Media, 'id' | 'type'>
  title: string
  /** Shown after the link, e.g. `(1999) ⭐8.7`. */
  details?: string
}

/**
 * A numbered list of `items`, each title linking to its page on the download
 * site. Built in code rather than by the model for the same reason as
 * {@link withDownloadLinks}, and numbered from 1 in `items` order so "the
 * second one" still names the right title. `<…>` keeps Discord from
 * unfurling every link.
 */
export function selectionList(items: SelectionListItem[]): string {
  return items
    .map((item, index) => {
      const link = `[${escapeLinkText(item.title)}](<${downloadLinks(item.media).media}>)`
      const details = item.details ? ` ${item.details}` : ''

      return `${index + 1}. ${link}${details}`
    })
    .join('\n')
}

/**
 * The line {@link withDownloadLinks} appends, as the model may echo it: it
 * sees earlier replies that end with one, so it can copy it into its own text
 * (with any URL or title).
 */
const ECHOED_LINKS_LINE_REGEX =
  /^[ \t]*Follow along on the \[activity page\].*$/gim

/**
 * A copy of `response` with a line linking the activity page and the title's
 * page appended. Added in code rather than handed to the model, which can
 * reword or mangle a URL. `<…>` keeps Discord from unfurling either link.
 * A copy of that line the model wrote itself is dropped so it isn't shown
 * twice.
 */
export function withDownloadLinks(
  response: HumanMessage,
  media: Pick<Media, 'id' | 'type'>,
  title: string,
): HumanMessage {
  const links = downloadLinks(media)
  const line = `Follow along on the [activity page](<${links.activity}>), or open [${escapeLinkText(title)}](<${links.media}>).`

  const text = response.content
    .toString()
    .replace(ECHOED_LINKS_LINE_REGEX, '')
    .trimEnd()

  return new HumanMessage({
    id: response.id ?? nanoid(),
    content: `${text}\n\n${line}`,
  })
}
