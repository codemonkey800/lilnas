/**
 * What the nav-bar field decides the current text is, on every keystroke.
 *
 * Three cases, mutually exclusive, matching spec §"Entry-point model":
 *
 *   - `url` — paste a video link. `url` is always scheme-ful and safe to hand
 *     straight to `POST /download/videos`, whose body schema is
 *     `z.string().url()` and would reject the bare `youtube.com/watch?v=…`
 *     the user actually typed.
 *   - `search` — anything else that has cleared {@link SEARCH_MIN_LENGTH}.
 *     `query` is the trimmed text, ready to be the `?q=` of `/search`.
 *   - `idle` — nothing worth offering an action for yet.
 */
export type QueryClassification =
  | { kind: 'url'; url: string }
  | { kind: 'search'; query: string }
  | { kind: 'idle' }

/**
 * The same 2-character floor §3's search itself uses. Below it the field shows
 * no button at all, so the two surfaces can never disagree about when a query
 * has become searchable.
 */
export const SEARCH_MIN_LENGTH = 2

/**
 * Does the text open with something that looks like a *scheme*? Used only to
 * decide which of the two parse strategies below applies — a string that
 * announces a scheme is judged on that scheme rather than being quietly
 * re-parsed as if it had none.
 */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * A bare `host[:port]` at the very start of the text, followed by the end of
 * the string or the first `/`, `?` or `#`.
 *
 * This regex is the whole reason `office` is a search and `youtube.com` is a
 * link: `new URL('https://office')` parses perfectly happily, so the WHATWG
 * parser alone would classify every single bare word as a URL and the search
 * branch would be unreachable. Requiring at least one dot plus an alphabetic
 * 2+ character last label is the cheapest rule that separates a registrable
 * domain from a word.
 *
 * Two deliberate consequences, both preferring "it is a search":
 *
 *   - `192.168.1.5/clip` and `localhost:3000/clip` are NOT links without an
 *     explicit scheme (the last label is not alphabetic). Typing `http://`
 *     in front of either makes them links again, and neither is a plausible
 *     thing to paste into a public video downloader.
 *   - An email address (`someone@example.com`) is not a link, because the
 *     match is anchored and `@` is not a host character. Without the anchor
 *     `https://someone@example.com` would parse as host `example.com` with
 *     userinfo attached, and pasting an address would offer a Download button.
 */
const BARE_AUTHORITY =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?=$|[/?#])/i

/**
 * The scheme-ful, ready-to-POST form of `text`, or `null` if it is not a link.
 *
 * ⚠️ **Never fires a network request.** This is a `URL` parse and a regex, and
 * nothing else — the field has no "resolving" state to render precisely
 * because there is nothing to wait for.
 *
 * The returned string is the user's own text (with `https://` prepended when
 * they omitted a scheme) rather than `parsed.toString()`. Round-tripping
 * through the URL serializer re-encodes the query string, and for the shape
 * this service mostly sees the video's whole identity lives in that query
 * string — so the normalized form is a different link to yt-dlp than the one
 * that was pasted, for no benefit.
 */
function asDownloadableUrl(text: string): string | null {
  if (HAS_SCHEME.test(text)) {
    let parsed: URL

    try {
      parsed = new URL(text)
    } catch {
      // "URL-shaped but fails to parse a host" — `https://`, `http://:8080`,
      // `https://?q=1`. Spec calls these out explicitly as not-a-URL.
      return null
    }

    // Anything that is not http(s) is not something this app can download, and
    // silently treating `javascript:…` or `file:///…` as a link would put a
    // Download button under text that must never be navigated to.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }

    return parsed.hostname ? text : null
  }

  if (!BARE_AUTHORITY.test(text)) {
    return null
  }

  const candidate = `https://${text}`

  try {
    // Belt and braces: the regex has already established a valid authority, so
    // this only rejects a malformed *remainder* (a stray `%` in the path, say).
    new URL(candidate)
  } catch {
    return null
  }

  return candidate
}

/**
 * Classify what is currently in the nav-bar field.
 *
 * Order matters: a link is a link at any length, so the URL test runs before
 * the character floor. Nothing below the floor that is not a link can be
 * anything but `idle`, which is why the floor is checked last rather than as
 * an early return.
 */
export function classifyQuery(text: string): QueryClassification {
  const trimmed = text.trim()

  if (trimmed.length === 0) {
    return { kind: 'idle' }
  }

  const url = asDownloadableUrl(trimmed)

  if (url !== null) {
    return { kind: 'url', url }
  }

  if (trimmed.length < SEARCH_MIN_LENGTH) {
    return { kind: 'idle' }
  }

  return { kind: 'search', query: trimmed }
}
