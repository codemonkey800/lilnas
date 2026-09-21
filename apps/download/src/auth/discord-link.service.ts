import { AuthClient } from '@lilnas/utils/auth/client'
import type {
  DiscordLinkLookupParams,
  DiscordLinkLookupResponse,
} from '@lilnas/utils/auth/types'
import { Injectable, Logger } from '@nestjs/common'

/**
 * What `registerObservedIdentity` needs to report a Discord account upward.
 *
 * Structurally identical to `AuthClient.registerDiscordIdentity`'s parameter
 * (and therefore accepts an `@lilnas/utils/auth/types` `DiscordIdentity`,
 * whose `displayName: string | null` satisfies the optional field) so callers
 * can hand a header-derived object straight through. NOT the same shape as
 * `@lilnas/utils/download/types`' `DiscordRequester` /`DiscordIdentity`, which
 * spell the handle `discordUsername` - that pair is the *wire* contract for a
 * job row, this one is auth's roster contract.
 */
export interface ObservedDiscordIdentity {
  discordUserId: string
  username: string
  displayName?: string | null
}

type CacheEntry =
  | { kind: 'link'; link: DiscordLinkLookupResponse; expiresAtMs: number }
  | { kind: 'registration'; expiresAtMs: number }

/** A fresh object per call - never a shared mutable singleton. */
function unlinked(): DiscordLinkLookupResponse {
  return { identity: null, user: null }
}

// A short in-memory TTL cache in front of apps/auth's
// GET /internal/discord-link, shaped after AdminCheckService (same TTLs, same
// oldest-first bounded map) because it is called from the same places for the
// same reason: attribution rendering runs on most list/detail requests, and a
// network round trip per request per requester is not affordable.
//
// One deliberate inversion, though: AdminCheckService fails **closed** and
// this one fails **open**. Admin status is a permission - guessing wrong
// leaks hidden attribution to a non-admin, so an auth outage must resolve to
// "not an admin". A Discord link is a *display detail*: the worst case of
// guessing wrong is a job rendering as "@handle" instead of "Alice", which is
// exactly how it rendered before this feature existed. Failing closed here
// would mean an auth blip 500s or blanks an otherwise-fine download list, so
// an outage degrades to `null`/"unlinked" with a warn instead.
//
// Failing open also buys deploy-order safety: `/internal/discord-link` and
// `/internal/discord-identity` may not exist yet on the deployed auth (they
// ship in a later wave). A 404 from an older auth throws inside AuthClient,
// lands in the catch below, and degrades to "unlinked" - so this service can
// be deployed first, in either order, with no coordination.
//
// Three keyspaces share one map (and therefore one MAX_CACHE_ENTRIES budget),
// disambiguated by key prefix:
//   d:<snowflake>          -> the link lookup keyed by Discord user id
//   u:<lilnasUserId>       -> the link lookup keyed by lilnas user id
//   seen:<snowflake>:<handle> -> "already reported this identity to auth"
// The prefixes matter: a lilnas user id and a snowflake are both opaque
// strings and must never collide into one entry.
//
// The bound is the same defense-in-depth AdminCheckService documents: the
// snowflake keyspace arrives in `X-Discord-User-Id`, a header this container
// accepts from anything on the shared lilnas Docker network (see
// discord-user.ts's trust-model comment), so nothing external narrows it.
@Injectable()
export class DiscordLinkService {
  private static readonly TTL_MS = 60_000
  // Short TTL for a *thrown* lookup - long enough that a sustained auth
  // outage isn't hammered once per request, short enough that recovery is
  // noticed quickly. Note what does NOT use it: see cacheLink below.
  private static readonly FAILURE_TTL_MS = 10_000
  // Oldest-entry eviction once the cache hits this size - see the class
  // comment on why the keyspaces aren't otherwise bounded.
  private static readonly MAX_CACHE_ENTRIES = 500

  private readonly cache = new Map<string, CacheEntry>()
  private readonly authClient = AuthClient.dockerInstance
  private readonly logger = new Logger(DiscordLinkService.name)

  /**
   * Resolves a Discord snowflake to auth's two-part envelope: the Discord
   * account as auth last observed it (`identity`) and the lilnas account it
   * is linked to (`user`), either of which may independently be `null`.
   *
   * Never rejects - an auth failure resolves to `{ identity: null, user:
   * null }`, which reads downstream as "we know nothing about this Discord
   * user", the same answer a genuinely-unseen snowflake produces.
   */
  resolveDiscordUser(
    discordUserId: string,
  ): Promise<DiscordLinkLookupResponse> {
    // No normalization: a snowflake is an opaque digit string (auth validates
    // it against /^\d{17,20}$/), not a case-insensitive email like
    // AdminCheckService's keyspace.
    return this.lookup(`d:${discordUserId}`, { discordUserId })
  }

  /**
   * The reverse direction: the Discord snowflake linked to a lilnas user, or
   * `null` when that user has no linked Discord account (or when auth can't
   * be reached - see the class comment on failing open).
   */
  async getLinkedDiscordUserId(lilnasUserId: string): Promise<string | null> {
    const { identity } = await this.lookup(`u:${lilnasUserId}`, {
      userId: lilnasUserId,
    })
    return identity?.discordUserId ?? null
  }

  /**
   * Best-effort "I just saw this Discord account" report to auth's roster, so
   * an admin can link a Discord user that has never signed in to lilnas.
   *
   * Returns **synchronously** and **never throws**, by construction: it
   * starts the POST and swallows the outcome. A roster write is bookkeeping
   * for a screen nobody is currently looking at - it must never add latency
   * to, or fail, the download it was observed on. Callers therefore do not
   * (and cannot usefully) await it.
   *
   * De-duplicated by a `seen:<snowflake>:<handle>` memo on the same TTL, so a
   * burst of `/download` commands from one person produces one POST rather
   * than one per job. The handle being *part of the key* is deliberate and is
   * the entire rename-detection path: a renamed user hashes to a different
   * memo key, misses, and is re-reported immediately instead of waiting for
   * some separate reconciliation job to notice.
   *
   * `displayName` is intentionally NOT in the memo key. It is free text that
   * can change without the username changing; folding it in would widen the
   * keyspace for a field only rendered in auth's admin link picker. A
   * display-name-only change is picked up on the next memo expiry.
   */
  registerObservedIdentity(identity: ObservedDiscordIdentity): void {
    const key = `seen:${identity.discordUserId}:${identity.username}`
    const cached = this.cache.get(key)
    if (cached && cached.expiresAtMs > Date.now()) {
      return
    }

    // Memoized *before* the await, not after, so N concurrent observations of
    // the same identity produce one POST instead of N.
    this.setCacheEntry(key, {
      kind: 'registration',
      expiresAtMs: Date.now() + DiscordLinkService.TTL_MS,
    })

    // The outer try/catch is not redundant with the .catch(): it covers a
    // *synchronous* throw out of the client (a rejected promise is only one
    // of the two ways this can fail), and "never throws" is the contract this
    // method's callers rely on.
    try {
      void this.authClient
        .registerDiscordIdentity(identity)
        .catch((err: unknown) => this.onRegistrationFailure(key, err))
    } catch (err) {
      this.onRegistrationFailure(key, err)
    }
  }

  private onRegistrationFailure(key: string, err: unknown): void {
    // debug, not warn: auth being unreachable is already warn-logged by the
    // lookup path, and a roster write failing changes nothing a user can see.
    this.logger.debug(
      {
        action: 'registerObservedIdentity',
        key,
        error: err instanceof Error ? err.message : String(err),
      },
      'Failed to report a Discord identity to auth — ignoring',
    )
    // Downgrade the memo to the failure TTL so the next observation retries
    // in ~10s rather than sitting on a failed write for the full minute.
    this.setCacheEntry(key, {
      kind: 'registration',
      expiresAtMs: Date.now() + DiscordLinkService.FAILURE_TTL_MS,
    })
  }

  /**
   * The shared cached/fail-open path behind both public lookups. Takes the
   * cache key and the single-key lookup params separately because the two
   * directions are two distinct keyspaces over the same auth route.
   */
  private async lookup(
    key: string,
    params: DiscordLinkLookupParams,
  ): Promise<DiscordLinkLookupResponse> {
    const cached = this.cache.get(key)
    if (cached?.kind === 'link' && cached.expiresAtMs > Date.now()) {
      return cached.link
    }

    try {
      const link = await this.authClient.getDiscordLink(params)
      // Full TTL, including for `{ identity: null, user: null }` - see
      // cacheLink's comment on why that is emphatically not a failure.
      this.cacheLink(key, link, DiscordLinkService.TTL_MS)
      return link
    } catch (err) {
      this.logger.warn(
        {
          action: 'resolveDiscordLink',
          key,
          error: err instanceof Error ? err.message : String(err),
        },
        'Failed to reach auth for a Discord link — treating as unlinked',
      )
      const fallback = unlinked()
      this.cacheLink(key, fallback, DiscordLinkService.FAILURE_TTL_MS)
      return fallback
    }
  }

  // Only a *thrown* lookup gets FAILURE_TTL_MS. A 200 of `{ identity: null,
  // user: null }` is a successful answer that happens to be negative, and
  // caching it for 10s instead of 60s would be a real regression: once the
  // reverse direction is wired into list rendering, "this person has no
  // linked Discord account" is the answer for most users on most page loads,
  // so treating it as a failure would re-hit auth for every unlinked
  // requester on every request - precisely the traffic this cache exists to
  // prevent. Keeping "unknown" a 200 rather than a 404 (see
  // DiscordLinkLookupResponse's doc comment) is what makes the two
  // distinguishable at all.
  private cacheLink(
    key: string,
    link: DiscordLinkLookupResponse,
    ttlMs: number,
  ): void {
    this.setCacheEntry(key, {
      kind: 'link',
      link,
      expiresAtMs: Date.now() + ttlMs,
    })
  }

  private setCacheEntry(key: string, entry: CacheEntry): void {
    if (
      !this.cache.has(key) &&
      this.cache.size >= DiscordLinkService.MAX_CACHE_ENTRIES
    ) {
      // Map iterates keys in insertion order - the first key yielded is
      // the oldest entry still held, evicted to make room for this one.
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey)
      }
    }
    this.cache.set(key, entry)
  }
}
