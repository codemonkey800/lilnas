import { env } from '@lilnas/utils/env'
import { Injectable } from '@nestjs/common'
import { z, type ZodType } from 'zod'

import { EnvKeys } from 'src/env'

import type { SabHistory, SabQueue } from './sabnzbd.schema'
import {
  SabApiErrorSchema,
  SabHistoryResponseSchema,
  SabQueueResponseSchema,
  SabVersionResponseSchema,
} from './sabnzbd.schema'

/**
 * The only SAB API modes this client may call. SAB's full API key is SAB
 * admin - the same key can delete jobs, change config and shut SAB down -
 * so the client is read-only by construction: `request()` refuses any mode
 * outside this list before a request is built.
 *
 * Writes (delete, retry, change category, ...) belong to Radarr/Sonarr: a
 * delete done directly in SAB makes the item vanish from the *arr with no
 * blocklist or re-search. Do not grow this list with a write mode.
 */
export const SAB_READ_MODES = ['version', 'queue', 'history'] as const
export type SabReadMode = (typeof SAB_READ_MODES)[number]

export function isSabReadMode(mode: string): mode is SabReadMode {
  return (SAB_READ_MODES as readonly string[]).includes(mode)
}

/**
 * Matches the 10s ceiling the other container-to-container clients in this
 * app use (see EmbyService).
 */
const REQUEST_TIMEOUT_MS = 10_000

/**
 * SAB answered HTTP 403: the API key was wrong or missing, or SAB's
 * host/external-access checks refused this caller. Classified on the status
 * code alone - the plain-text body is empty when SAB's `api_warnings` is
 * off, and is never included here.
 */
export class SabnzbdAuthError extends Error {
  constructor() {
    super(
      'SABnzbd rejected the API key or host (HTTP 403) - check that ' +
        'SABNZBD_API_KEY is the full API key and that SABnzbd accepts ' +
        'requests from this host',
    )
    this.name = 'SabnzbdAuthError'
  }
}

/**
 * SAB answered HTTP 200 with its `{"status": false, "error": "..."}`
 * envelope. `sabError` is SAB's own error text.
 */
export class SabnzbdApiError extends Error {
  constructor(
    readonly mode: SabReadMode,
    readonly sabError: string,
  ) {
    super(`SABnzbd ${mode} request returned an error: ${sabError}`)
    this.name = 'SabnzbdApiError'
  }
}

export interface SabHistoryQuery {
  /**
   * Jobs to fetch, by SAB `nzo_id` (== Radarr/Sonarr `downloadId`). SAB
   * applies `limit` after this filter, so pass a `limit` of at least
   * `nzoIds.length` to get every match.
   */
  nzoIds: string[]
  /**
   * Always explicit and >= 1: SAB reads `limit=0` (or no limit) as its
   * configured `history_limit`, not as "all".
   */
  limit: number
  /** Read the archive instead of the default history view. */
  archive?: boolean
  /**
   * The `last_history_update` counter from the previous answer. When SAB's
   * counter still equals it, SAB answers `{"history": false}` (-> `null`).
   */
  lastUpdate?: number
}

/**
 * Thin, typed, READ-ONLY HTTP client for SABnzbd. Raw HTTP only - no
 * caching, no retries, no polling; the monitor that builds on it owns
 * those.
 *
 * Optional feature: with `SABNZBD_URL` or `SABNZBD_API_KEY` unset,
 * `enabled` is false and every call throws without making a request.
 *
 * Failures throw, and no thrown error ever carries the request URL (it
 * holds the API key as a query param):
 * - network failure/timeout -> `Error('SABnzbd <mode> request failed')`,
 *   deliberately WITHOUT the original as `cause` (undici's cause carries
 *   the URL)
 * - HTTP 403 -> `SabnzbdAuthError`
 * - other non-2xx -> `Error` naming the mode and status
 * - HTTP 200 `{"status": false}` -> `SabnzbdApiError`
 * - body not matching its schema -> `Error` with the zod issues
 */
@Injectable()
export class SabnzbdService {
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor() {
    // - Defaults, unlike EmbyService: SAB is optional, and env() throws on
    //   an unset var without one.
    this.baseUrl = env(EnvKeys.SABNZBD_URL, '').trim().replace(/\/+$/, '')
    this.apiKey = env(EnvKeys.SABNZBD_API_KEY, '').trim()
  }

  /** True when both `SABNZBD_URL` and `SABNZBD_API_KEY` are set. */
  get enabled(): boolean {
    return this.baseUrl !== '' && this.apiKey !== ''
  }

  /** `mode=version` - SAB's version string, e.g. "5.1.3". */
  async getVersion(): Promise<string> {
    const { version } = await this.request('version', SabVersionResponseSchema)

    return version
  }

  /**
   * `mode=queue&limit=0` - the whole queue, unfiltered. Never filter by
   * category: per-slot `timeleft` is cumulative over the queue order, so a
   * filtered view under-reports it.
   */
  async getQueue(): Promise<SabQueue> {
    const { queue } = await this.request('queue', SabQueueResponseSchema, {
      limit: '0',
    })

    return queue
  }

  /**
   * `mode=history` for specific jobs. Resolves `null` when SAB reports the
   * history unchanged since `lastUpdate` (`{"history": false}`).
   *
   * An empty `nzoIds` makes no request and resolves an empty history whose
   * `last_history_update` echoes `lastUpdate` (so storing it is a no-op),
   * or `0` when none was given - a value SAB's counter never holds (it
   * starts at 1 and wraps to 1), so the next real call always fetches.
   */
  async getHistory({
    nzoIds,
    limit,
    archive = false,
    lastUpdate,
  }: SabHistoryQuery): Promise<SabHistory | null> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(
        `SABnzbd history limit must be an integer >= 1 (got ${limit}); ` +
          'SAB reads 0 as its history_limit, not "all"',
      )
    }

    if (nzoIds.length === 0) {
      return {
        last_history_update: lastUpdate ?? 0,
        ppslots: 0,
        noofslots: 0,
        slots: [],
      }
    }

    const params: Record<string, string> = {
      nzo_ids: nzoIds.join(','),
      limit: String(limit),
    }
    if (archive) params.archive = '1'
    if (lastUpdate !== undefined) {
      params.last_history_update = String(lastUpdate)
    }

    const { history } = await this.request(
      'history',
      SabHistoryResponseSchema,
      params,
    )

    return history === false ? null : history
  }

  /**
   * Builds `{SABNZBD_URL}/api?...&output=json&apikey=...`. SAB accepts the
   * key only as the `apikey` query param - it has no header auth. The fixed
   * params are set last so `params` can't override them. The result holds
   * the key: never log it or put it in an error.
   */
  private buildUrl(mode: SabReadMode, params: Record<string, string>): string {
    const query = new URLSearchParams({
      ...params,
      mode,
      output: 'json',
      apikey: this.apiKey,
    })

    return `${this.baseUrl}/api?${query.toString()}`
  }

  /**
   * One GET, one schema. Takes `mode` as a plain string on purpose so the
   * allowlist check is a real runtime guard, not only a type.
   */
  private async request<T>(
    mode: string,
    schema: ZodType<T>,
    params: Record<string, string> = {},
  ): Promise<T> {
    if (!isSabReadMode(mode)) {
      throw new Error(
        `SABnzbd mode "${mode}" is not allowed - this client is read-only ` +
          `(${SAB_READ_MODES.join(', ')})`,
      )
    }

    if (!this.enabled) {
      throw new Error(
        'SABnzbd is not configured (SABNZBD_URL / SABNZBD_API_KEY unset)',
      )
    }

    let response: Response
    try {
      response = await fetch(this.buildUrl(mode, params), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      // - Rewrapped with no `cause`: undici's cause carries the URL, and
      //   with it the API key.
      throw new Error(
        `SABnzbd ${mode} request failed${isTimeout(error) ? ' (timed out)' : ''}`,
      )
    }

    if (response.status === 403) {
      await discardBody(response)
      throw new SabnzbdAuthError()
    }

    if (!response.ok) {
      await discardBody(response)
      throw new Error(
        `SABnzbd ${mode} request failed with HTTP ${response.status}`,
      )
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      // - Same as above: a mid-body network error's cause can carry the URL.
      throw new Error(`SABnzbd ${mode} response was not valid JSON`)
    }

    // - Checked before the success schema: SAB reports API errors as
    //   HTTP 200 with this envelope.
    const apiError = SabApiErrorSchema.safeParse(body)
    if (apiError.success) {
      throw new SabnzbdApiError(mode, apiError.data.error)
    }

    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      throw new Error(
        `SABnzbd ${mode} response did not match the expected shape:\n` +
          z.prettifyError(parsed.error),
      )
    }

    return parsed.data
  }
}

/**
 * `AbortSignal.timeout` rejects with a DOMException, which is not an
 * `instanceof Error` in every realm - so check the name structurally.
 */
function isTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) {
    return false
  }

  return error.name === 'TimeoutError' || error.name === 'AbortError'
}

/** Releases an unread body so the connection can be reused. */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // - Nothing to recover: the error being thrown is the real outcome.
  }
}
