import {
  DownloadType,
  isManagedMedia,
  type Media,
  type Movie,
  type Show,
} from '@lilnas/utils/download/types'
import { env } from '@lilnas/utils/env'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'

import { EnvKeys } from 'src/env'

import { EmbyService } from './emby.service'

/**
 * The Emby `Type` that backs each managed media type. A movie is one Emby
 * `Movie` item; a show is one Emby `Series` item (the folder), never an
 * `Episode` - per-episode deep links are out of scope, so an episode row
 * could only ever produce a false match against a series folder.
 */
const EMBY_ITEM_TYPES = {
  [DownloadType.Movie]: 'Movie',
  [DownloadType.Show]: 'Series',
} as const satisfies Record<DownloadType.Movie | DownloadType.Show, string>

/**
 * One path-index entry. `entries` absent means "the last lookup failed" -
 * deliberately NOT an empty map. `MediaResolverService` caches its failures
 * as an empty map because an empty library there degrades to a per-id
 * lookup; here an empty map would be indistinguishable from "Emby has
 * nothing indexed" and would report every title as `indexing` for the whole
 * failure window, which is a confident wrong answer instead of `unknown`.
 */
interface PathIndexCacheEntry {
  entries?: Map<string, string>
  error?: string
  expiresAtMs: number
}

/** Trims a single trailing `/`. Case is preserved - these are Linux paths. */
function normalizePath(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path
}

/**
 * The path index is keyed by `(Emby item type, normalized path)` so a movie
 * can only ever match a `Movie` and a show only a `Series`. NUL is the
 * separator because it is the one byte a POSIX path cannot contain, so no
 * path can forge a key belonging to another type.
 */
function indexKey(embyType: string, path: string): string {
  return `${embyType}\u0000${normalizePath(path)}`
}

/**
 * Answers "has Emby indexed this yet, and where do I watch it" for media
 * that already has a file on disk.
 *
 * Layered on {@link EmbyService}, which is raw HTTP and throws on anything
 * unexpected; classifying those throws is this service's whole job. Three
 * in-memory caches keep a 10s poller tick from turning into 10s of Emby
 * traffic: the user id and server id are resolved once per process, and the
 * path index is a read-through cache with a 60s success / 10s failure TTL
 * (the same shape, and the same reasoning, as
 * `MediaResolverService.getMovieLibrary()`).
 *
 * Matching is by **on-disk path only**, never title or year: `infra/media.yml`
 * mounts the same host directories at the same container paths in Radarr,
 * Sonarr and Emby, so the paths compare byte-equal, while Emby renders titles
 * differently from the *arrs. There is no fuzzy fallback - if the mounts ever
 * diverge, every title degrades to `indexing`, which is visible and
 * diagnosable rather than silently pointing at the wrong item.
 */
@Injectable()
export class EmbyStatusService {
  /** Mirrors `MediaResolverService`'s library cache TTLs. */
  private static readonly TTL_MS = 60_000
  private static readonly FAILURE_TTL_MS = 10_000

  private readonly logger = new Logger(EmbyStatusService.name)

  private readonly externalUrl: string
  private readonly username: string

  private userId?: string
  private serverId?: string
  private pathIndexCache?: PathIndexCacheEntry

  constructor(private readonly embyService: EmbyService) {
    // Read at construction time so a misconfigured deployment fails at boot
    // rather than at the first request - the same choice EmbyService makes.
    this.externalUrl = env(EnvKeys.EMBY_EXTERNAL_URL).replace(/\/+$/, '')
    this.username = env(EnvKeys.EMBY_USERNAME)
  }

  /**
   * Annotates every downloaded movie/show in `media` with its Emby state,
   * **mutating each object in place** (nothing is returned, and the input is
   * iterated exactly once, so a one-shot iterator like `Map.values()` is
   * fine).
   *
   * The invariant on what gets written:
   *
   * | Situation                                   | `embyStatus`                            |
   * | ------------------------------------------- | --------------------------------------- |
   * | No `filePath` (not downloaded / search hit) | left **absent** - Emby never consulted  |
   * | File on disk, matching Emby item             | `{ state: 'indexed', itemId, watchUrl }` |
   * | File on disk, no matching Emby item          | `{ state: 'indexing' }`                  |
   * | File on disk, Emby unreachable               | `{ state: 'unknown' }`                   |
   *
   * `indexed` is the only state that ever carries `itemId`/`watchUrl`; the
   * other two carry neither. A `Video` has no `embyStatus` field at all and
   * is skipped.
   *
   * Never throws. `MediaResolverService.resolve()` has a documented no-throw
   * guarantee and this runs inside it, on a 10s cron, for every list
   * endpoint - a degraded Emby must cost a badge, not a page.
   */
  async annotate(media: Iterable<Media>): Promise<void> {
    const candidates: Array<{ media: Movie | Show; path: string }> = []

    for (const item of media) {
      // No file on disk means Emby has nothing to have indexed - a search or
      // discover hit, or a title that was requested but hasn't landed yet.
      // Leaving the field absent (rather than writing `indexing`) is what
      // lets the frontend tell "not downloaded" from "downloaded, waiting".
      if (!isManagedMedia(item) || !item.filePath) continue

      candidates.push({ media: item, path: item.filePath })
    }

    // The early return is load-bearing, not an optimization: `resolve()` runs
    // on every poller tick, and a video-only page or a search response would
    // otherwise pay a full Emby round trip to learn nothing.
    if (candidates.length === 0) return

    let serverId: string
    let index: Map<string, string>

    try {
      // Sequential because the item query is keyed by the user id; the
      // server id is independent, so it rides along with the item fetch.
      const userId = await this.getUserId()
      ;[serverId, index] = await Promise.all([
        this.getServerId(),
        this.getPathIndex(userId),
      ])
    } catch (err) {
      this.logger.warn(
        {
          action: 'annotate',
          candidates: candidates.length,
          error: getErrorMessage(err),
        },
        'Emby lookup failed - reporting every downloaded title as unknown',
      )

      for (const candidate of candidates) {
        candidate.media.embyStatus = { state: 'unknown' }
      }

      return
    }

    for (const { media: candidate, path } of candidates) {
      const itemId = index.get(indexKey(EMBY_ITEM_TYPES[candidate.type], path))

      candidate.embyStatus = itemId
        ? {
            itemId,
            state: 'indexed',
            watchUrl: this.buildWatchUrl(itemId, serverId),
          }
        : { state: 'indexing' }
    }
  }

  /**
   * The browser-facing deep link. Built from `EMBY_EXTERNAL_URL`
   * (`https://emby.lilnas.io`) and never `EMBY_URL`, which is the
   * container-internal API address and unreachable from a browser.
   */
  private buildWatchUrl(itemId: string, serverId: string): string {
    return `${this.externalUrl}/web/index.html#!/item?id=${itemId}&serverId=${serverId}`
  }

  /**
   * The id of the configured `EMBY_USERNAME`, cached for the process
   * lifetime - Emby user ids are stable, and a rename is a redeploy.
   */
  private async getUserId(): Promise<string> {
    if (this.userId) return this.userId

    const users = await this.embyService.getUsers()
    const match = users.find(user => user.Name === this.username)

    if (!match) {
      // The available names are the entire debugging story for a
      // misconfigured username, and they are not recoverable from anywhere
      // else in the logs - Emby matches exactly, including case.
      const available = users.map(user => user.Name)

      this.logger.warn(
        { action: 'getUserId', availableUsers: available },
        `No Emby user named '${this.username}' - EMBY_USERNAME must match ` +
          `one of these exactly: ${available.length > 0 ? available.join(', ') : '(none)'}`,
      )

      throw new Error(`No Emby user named '${this.username}'`)
    }

    this.userId = match.Id

    return match.Id
  }

  /** The server id every watch URL is scoped by. Cached for the process. */
  private async getServerId(): Promise<string> {
    if (this.serverId) return this.serverId

    const { Id: serverId } = await this.embyService.getSystemInfo()
    this.serverId = serverId

    return serverId
  }

  /**
   * `normalized path -> Emby item id` for the whole library, from one
   * `/Items` call. Read-through with a 60s success / 10s failure TTL; a
   * cached failure re-throws rather than serving an empty index, so the
   * failure window reports `unknown` instead of a library that looks empty.
   */
  private async getPathIndex(userId: string): Promise<Map<string, string>> {
    const now = Date.now()
    const cached = this.pathIndexCache

    if (cached && cached.expiresAtMs > now) {
      if (!cached.entries) {
        throw new Error(cached.error ?? 'Emby library lookup failed')
      }

      return cached.entries
    }

    try {
      const items = await this.embyService.getLibraryItems(userId)
      const entries = new Map<string, string>()

      for (const item of items) {
        // `Path` is permission-gated and `Type` is optional, and an entry
        // missing either can't be matched against anyway - a media whose
        // path is only held by such an entry reports `indexing`, the same
        // answer as any other miss.
        if (!item.Path || !item.Type) continue

        // Last write wins on a duplicate path (two library entries pointing
        // at one folder). Either id resolves to the same content, so which
        // one survives doesn't matter.
        entries.set(indexKey(item.Type, item.Path), item.Id)
      }

      this.pathIndexCache = {
        entries,
        expiresAtMs: now + EmbyStatusService.TTL_MS,
      }

      return entries
    } catch (err) {
      this.pathIndexCache = {
        error: getErrorMessage(err),
        expiresAtMs: now + EmbyStatusService.FAILURE_TTL_MS,
      }

      throw err
    }
  }
}
