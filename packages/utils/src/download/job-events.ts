import { z } from 'zod'

import {
  DownloadJobSchema,
  EpisodeStateEntrySchema,
  MediaSchema,
} from './schema'
import type {
  DownloadGatewayMessage,
  DownloadJobEvent,
  MediaEvent,
} from './types'
import {
  DOWNLOAD_JOB_EVENT_TYPE,
  DownloadJobEventType,
  MEDIA_EVENT_TYPE,
} from './types'

/**
 * Reconnect backoff schedule, in milliseconds. Attempt `n` waits
 * `DEFAULT_RECONNECT_DELAYS_MS[n]`, clamped to the last entry — so a backend
 * that stays down settles at one attempt every 15s per tab rather than
 * hammering it forever at the 1s cadence the polling loop this replaces used
 * to run at.
 *
 * The counter resets when a socket actually **opens**, not when one is
 * merely created: a connect that fails instantly (backend down, proxy
 * refusing the upgrade) must keep climbing the ladder, and only a genuinely
 * healthy connection earns a fast retry on the next blip.
 */
export const DEFAULT_RECONNECT_DELAYS_MS = [
  1_000, 2_000, 4_000, 8_000, 15_000,
] as const

/**
 * Each delay is scaled by ±20%. Every open tab is woken by the same backend
 * restart, so an unjittered schedule would land all of them on the same
 * millisecond and re-create the stampede the backoff exists to prevent.
 */
export const RECONNECT_JITTER_RATIO = 0.2

/** Used only if the delay table is somehow empty — see `reconnectDelayMs`. */
const FALLBACK_RECONNECT_DELAY_MS = 1_000

export function reconnectDelayMs(
  attempt: number,
  delays: readonly number[],
  random: () => number,
): number {
  const base =
    delays[Math.min(attempt, delays.length - 1)] ?? FALLBACK_RECONNECT_DELAY_MS
  return Math.round(base * (1 + (random() * 2 - 1) * RECONNECT_JITTER_RATIO))
}

export function isDownloadGatewayMessage(
  value: unknown,
): value is DownloadGatewayMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string'
  )
}

/**
 * Parses one raw frame from the download gateway into the job event it
 * describes, or `undefined` if it does not describe one — a non-string
 * payload, malformed JSON, some other envelope `type`, or a `job` that does
 * not satisfy `DownloadJobSchema`.
 *
 * Every rejection is **silent**. A video whose `sourceUrl` the schema
 * refuses still has a row on the page rendered from the server payload; a
 * throw here would take the whole subtree down over a field nobody was
 * looking at. The frame is dropped, the last good snapshot stands, and
 * `connected` keeps telling the truth.
 *
 * The payload goes through `DownloadJobSchema.safeParse()` rather than a
 * hand-rolled duck-type: it is the same schema the backend's wire type is
 * inferred from, so the two cannot drift.
 *
 * An unrecognized inner `DownloadJobEvent.type` is normalized to `Updated`
 * rather than dropped. `DownloadJobEvent.job` is documented as always being
 * a full current snapshot that a subscriber may upsert blind, so a future
 * third event kind should still move the UI forward instead of freezing it.
 */
export function parseJobEventFrame(
  rawData: unknown,
): DownloadJobEvent | undefined {
  if (typeof rawData !== 'string') return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(rawData)
  } catch {
    return undefined
  }

  if (!isDownloadGatewayMessage(parsed)) return undefined
  if (parsed.type !== DOWNLOAD_JOB_EVENT_TYPE) return undefined
  if (typeof parsed.data !== 'object' || parsed.data === null) return undefined
  if (!('job' in parsed.data)) return undefined

  const job = DownloadJobSchema.safeParse(parsed.data.job)
  if (!job.success) return undefined

  const eventType =
    'type' in parsed.data && parsed.data.type === DownloadJobEventType.Created
      ? DownloadJobEventType.Created
      : DownloadJobEventType.Updated

  return { job: job.data, type: eventType }
}

const EpisodeStateEntriesSchema = z.array(EpisodeStateEntrySchema)

/**
 * Parses one raw frame from the download gateway into the media event it
 * describes, or `undefined` if it does not describe one — a non-string
 * payload, malformed JSON, some other envelope `type`, or a `media` that
 * does not satisfy `MediaSchema`. The media-side twin of
 * {@link parseJobEventFrame}, and silent for the same reason.
 *
 * A bad `episodes` array does **not** reject the frame: the media is
 * returned with `episodes` omitted. The page's state chip reads `media`, so
 * it must not freeze over an episode row nobody is looking at.
 */
export function parseMediaEventFrame(rawData: unknown): MediaEvent | undefined {
  if (typeof rawData !== 'string') return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(rawData)
  } catch {
    return undefined
  }

  if (!isDownloadGatewayMessage(parsed)) return undefined
  if (parsed.type !== MEDIA_EVENT_TYPE) return undefined
  if (typeof parsed.data !== 'object' || parsed.data === null) return undefined
  if (!('media' in parsed.data)) return undefined

  const media = MediaSchema.safeParse(parsed.data.media)
  if (!media.success) return undefined

  if (!('episodes' in parsed.data)) return { media: media.data }

  const episodes = EpisodeStateEntriesSchema.safeParse(parsed.data.episodes)
  return episodes.success
    ? { episodes: episodes.data, media: media.data }
    : { media: media.data }
}

/**
 * An absolute `http(s)` origin parsed out of `baseUrl`, or `undefined` when
 * `baseUrl` is relative (or not a URL `http(s)` can parse at all — e.g. `""`
 * or a bare path like `/api`). `new URL()` throws on a relative input rather
 * than returning something with a blank `host`, which is exactly the signal
 * {@link jobEventsSocketUrl} needs to fall back to `location`.
 */
function absoluteHttpOrigin(
  baseUrl: string,
): Pick<Location, 'host' | 'protocol'> | undefined {
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url
  } catch {
    return undefined
  }
}

/**
 * The gateway URL for a client base. An absolute http(s) base maps scheme
 * and keeps host:port — `http://download:8081` → `ws://download:8081/ws`.
 * A relative base (`browserInstance`'s `/api`) is served by the Next.js
 * `/ws` rewrite on the PAGE origin, not under the base path, so it needs
 * `location` and ignores the base's path entirely. Throws when a relative
 * base is given with no location — there is nothing to derive from.
 */
export function jobEventsSocketUrl(
  baseUrl: string,
  location?: Pick<Location, 'host' | 'protocol'>,
): string {
  const origin = absoluteHttpOrigin(baseUrl) ?? location

  if (!origin) {
    throw new Error(
      `jobEventsSocketUrl: "${baseUrl}" is a relative base URL and requires a location to derive the origin from`,
    )
  }

  const scheme = origin.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${origin.host}/ws`
}
