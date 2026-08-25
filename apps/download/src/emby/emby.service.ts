import { env } from '@lilnas/utils/env'
import { Injectable, Logger } from '@nestjs/common'
import type { ZodType } from 'zod'

import { EnvKeys } from 'src/env'

import type { EmbyItem, EmbySystemInfo, EmbyUser } from './emby.schema'
import {
  EmbyItemsResponseSchema,
  EmbySystemInfoSchema,
  EmbyUsersResponseSchema,
} from './emby.schema'

/**
 * Every Emby HTTP API route lives under a `/emby` path prefix. Verified
 * against the live instance by
 * docs/features/download/designs/assets/fetch-assets.sh, the only Emby
 * integration in this repo known to have actually run.
 */
const EMBY_API_PREFIX = '/emby'

/**
 * Matches the 10s ceiling used for the other container-to-container calls
 * this service makes; long enough for a cold library query, short enough
 * that a wedged Emby doesn't hold a request handler open indefinitely.
 */
const REQUEST_TIMEOUT_MS = 10_000

/**
 * Thin, typed HTTP client for the Emby media server. Raw HTTP only - no
 * caching, no retries, no status classification. Callers that need any of
 * those build on top of this (see EmbyStatusService).
 *
 * Failures propagate: a non-2xx response, a network error, a timeout, and a
 * body that doesn't match its schema all throw. Deciding what a failure
 * *means* (degraded? unknown? fatal?) is a policy question this layer has
 * no business answering.
 */
@Injectable()
export class EmbyService {
  private readonly logger = new Logger(EmbyService.name)

  private readonly baseUrl: string
  private readonly apiKey: string

  constructor() {
    // Read at construction time, deliberately: env() throws on an unset
    // var, so a misconfigured deployment fails at boot rather than at the
    // first user request. Same choice the Radarr/Sonarr client factories
    // make in src/media/clients.ts.
    this.baseUrl = env(EnvKeys.EMBY_URL).replace(/\/+$/, '')
    this.apiKey = env(EnvKeys.EMBY_API_KEY)
  }

  /** `GET /emby/Users` - every user configured on the server. */
  async getUsers(): Promise<EmbyUser[]> {
    return this.request('/Users', EmbyUsersResponseSchema)
  }

  /**
   * `GET /emby/Users/{userId}/Items` - every movie and series visible to
   * the given user, with each item's on-disk `Path`.
   *
   * Sends no `Limit`: this treats the endpoint as unpaged. That assumption
   * has NOT been verified against the live library, so the
   * `TotalRecordCount` check below is the only detector we have for it
   * being wrong.
   */
  async getLibraryItems(userId: string): Promise<EmbyItem[]> {
    const response = await this.request(
      `/Users/${encodeURIComponent(userId)}/Items`,
      EmbyItemsResponseSchema,
      {
        IncludeItemTypes: 'Movie,Series',
        Recursive: 'true',
        Fields: 'Path',
      },
    )

    const { Items: items, TotalRecordCount: totalRecordCount } = response

    if (totalRecordCount != null && totalRecordCount > items.length) {
      this.logger.warn(
        `Emby returned ${items.length} of ${totalRecordCount} library items ` +
          `for user ${userId}: the response is paged, so this item list is ` +
          `TRUNCATED and any lookup against it will report false misses. Fix ` +
          `EmbyService.getLibraryItems() to page with StartIndex/Limit until ` +
          `it has collected TotalRecordCount items.`,
      )
    }

    return items
  }

  /** `GET /emby/System/Info` - reachability and API-key validity probe. */
  async getSystemInfo(): Promise<EmbySystemInfo> {
    return this.request('/System/Info', EmbySystemInfoSchema)
  }

  /**
   * Builds `{EMBY_URL}/emby{path}?...&api_key=...`.
   *
   * Auth is the `api_key` query parameter, the variant verified against
   * this instance by fetch-assets.sh. Emby also accepts an `X-Emby-Token`
   * header, but that variant is unverified here; since these calls are
   * container-to-container (`http://emby:8096`) and never leave the Docker
   * network, the query param's log-leak surface is acceptable.
   */
  private buildUrl(path: string, params: Record<string, string>): string {
    const query = new URLSearchParams({ ...params, api_key: this.apiKey })

    return `${this.baseUrl}${EMBY_API_PREFIX}${path}?${query.toString()}`
  }

  /**
   * One GET, one schema. Mirrors the hand-written fetch wrapper in
   * packages/utils/src/auth/client.ts: explicit timeout signal, explicit
   * `response.ok` check, explicit body validation - no interceptor magic.
   *
   * Thrown messages carry `path`, never the built URL, so the `api_key`
   * query param stays out of logs and error reports.
   */
  private async request<T>(
    path: string,
    schema: ZodType<T>,
    params: Record<string, string> = {},
  ): Promise<T> {
    const response = await fetch(this.buildUrl(path, params), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(
        `GET ${EMBY_API_PREFIX}${path} failed with ${response.status} ${response.statusText}`,
      )
    }

    const body: unknown = await response.json()

    return schema.parse(body)
  }
}
