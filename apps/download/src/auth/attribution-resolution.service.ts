import type { DiscordLinkLookupResponse } from '@lilnas/utils/auth/types'
import type {
  DiscordIdentity,
  DiscordRequester,
  JobRequester,
} from '@lilnas/utils/download/types'
import { Injectable } from '@nestjs/common'

import { DiscordLinkService } from './discord-link.service'

/**
 * A job as this service needs to see it - the three attribution fields of
 * `DownloadJob`, and nothing else. Structural rather than `DownloadJob`
 * itself so the generic methods below can hand a caller back its *own* type
 * (a `DownloadJob`, or anything that widens one) instead of flattening it.
 */
export interface ResolvableJob {
  discordRequester: DiscordRequester | null
  linkedDiscord: DiscordIdentity | null
  requester: JobRequester | null
}

/** `GalleryItem`'s pair. No `linkedDiscord` sibling - see `resolveGalleryItems`. */
export interface ResolvableGalleryItem {
  lastDiscordRequester: DiscordRequester | null
  lastRequester: JobRequester | null
}

/** `AuditLogEntry`'s pair. No `linkedDiscord` sibling either. */
export interface ResolvableAuditEntry {
  actor: JobRequester | null
  discordActor: DiscordRequester | null
}

/**
 * One row's attribution lifted out of whatever field names hold it, so the
 * three wire shapes above share one resolution algorithm instead of three
 * copies that can drift.
 */
interface AttributionSlot {
  discord: DiscordRequester | null
  requester: JobRequester | null
}

/** What resolution decided for one slot. Always a fresh object. */
interface ResolvedAttribution {
  discord: DiscordRequester | null
  linked: DiscordIdentity | null
  requester: JobRequester | null
}

/**
 * Every link answer a batch needed, keyed by the two id spaces it was asked
 * in. Built once per batch by `loadLinks` and consumed by `resolveSlot`,
 * which is pure.
 */
interface LinkMaps {
  byDiscordUserId: Map<string, DiscordLinkLookupResponse>
  byLilnasUserId: Map<string, DiscordLinkLookupResponse>
}

/**
 * Resolves Discord <-> lilnas account links onto rows **at read time**.
 *
 * Read time, not write time, is the whole point: linking an account in
 * `apps/auth` has to unify a person's *existing* history retroactively, and
 * the only way a stored row can do that is by not storing the answer at all.
 * So `jobs` keeps exactly what arrived (`hydrateJobRow` always hands back
 * `linkedDiscord: null` - there is no column behind it) and this service
 * fills the derived half on the way out.
 *
 * ## The two directions
 *
 * - **Forward** (`discordRequester` -> `requester`): a job submitted over
 *   Discord by somebody who has since linked their account renders as that
 *   person. Also refreshes the *displayed* handle from auth's roster, so a
 *   renamed-but-unlinked account shows the name it goes by now. The stored
 *   column is never written back - it stays the historical record of what
 *   they were called at the time, and it is what renders when auth is
 *   unreachable.
 * - **Reverse** (`requester` -> `linkedDiscord`): any job whose requester has
 *   a linked Discord account carries that account alongside the email.
 *
 * ## Why it lives in `src/auth/` rather than `src/download/`
 *
 * All three consumers - `DownloadController`, `DownloadStateService` (the WS
 * broadcast) and `AdminController` (the audit log) - already import
 * `AuthModule` for `AdminCheckService`/`AdminGuard`, so this placement adds
 * no edge to the module graph at all. Putting it under `DownloadModule`
 * would force `AdminModule` - deliberately a leaf - to import the whole
 * download feature module (and the `MediaModule` `forwardRef()` cycle behind
 * it) purely to render an audit row. `src/auth/discord-user.ts` already
 * imports the download wire types for the same reason, so the direction of
 * the dependency is established.
 *
 * Kept a separate class from `DiscordLinkService` rather than folded into
 * it: that one is the cached transport over auth's `/internal/discord-link`
 * and knows nothing of any wire shape; this one owns the batching and the
 * field mapping (auth spells the handle `username`, the download wire spells
 * it `discordUsername`).
 *
 * ## Cost
 *
 * A batch of N rows costs `D + U` lookups - one per *distinct* snowflake
 * needing the forward direction plus one per *distinct* requester id needing
 * the reverse - issued in a **single** `Promise.all` round, not two. Each is
 * served from `DiscordLinkService`'s 60s cache after its first miss, and a
 * negative answer is cached for the full TTL exactly like a positive one,
 * which is what keeps the reverse direction affordable: on a page of
 * web-origin jobs (the common case) most requesters have no link, and that
 * "no" must not be re-asked per row per request.
 *
 * Nothing here can fail a request: `DiscordLinkService` never rejects, so
 * auth being slow or down degrades to "no handle shown" - exactly how these
 * surfaces rendered before this feature existed.
 */
@Injectable()
export class AttributionResolutionService {
  constructor(private readonly discordLinkService: DiscordLinkService) {}

  /**
   * Both directions over a batch of jobs.
   *
   * **Idempotent**, deliberately: a second call over an already-resolved job
   * takes the same branches and computes the same answer, so a boundary that
   * ends up resolved twice (a helper plus a caller that also resolves)
   * produces the same bytes rather than double-applying anything.
   *
   * ⚠️ Resolution must run **before** `projectJobForViewer`, never after: the
   * mask nulls all three fields together, and re-populating them afterwards
   * would hand a non-admin the very identity `hiddenAttribution` exists to
   * withhold.
   */
  async resolveJobs<T extends ResolvableJob>(jobs: readonly T[]): Promise<T[]> {
    const rows = jobs.map(job => ({
      job,
      slot: { discord: job.discordRequester, requester: job.requester },
    }))

    const links = await this.loadLinks(
      rows.map(row => row.slot),
      true,
    )

    return rows.map(({ job, slot }) => {
      const { discord, linked, requester } = resolveSlot(slot, links)

      // `Object.assign` onto a fresh `{}` rather than an object-spread
      // literal: spreading a generic `T` erases it to an anonymous shape and
      // would force an `as T` back at the end. `Object.assign`'s `T & U`
      // return type carries the caller's own fields across without one, and
      // the fresh target leaves the input job untouched.
      return Object.assign({}, job, {
        discordRequester: discord,
        linkedDiscord: linked,
        requester,
      })
    })
  }

  /**
   * The forward direction only, over gallery cards.
   *
   * `GalleryItemSchema` has no `linkedDiscord` sibling to fill, so the
   * reverse direction is skipped outright rather than computed and thrown
   * away - which also means a gallery page of web-origin cards costs *zero*
   * lookups, the common case by a wide margin.
   *
   * Safe to run *after* `JobQueryService.listGallery`'s own masking (which
   * is inline there rather than a `projectJobForViewer` call): the mask
   * nulls `lastRequester` and `lastDiscordRequester` together, and a slot
   * with neither resolves to itself.
   */
  async resolveGalleryItems<T extends ResolvableGalleryItem>(
    items: readonly T[],
  ): Promise<T[]> {
    const rows = items.map(item => ({
      item,
      slot: {
        discord: item.lastDiscordRequester,
        requester: item.lastRequester,
      },
    }))

    const links = await this.loadLinks(
      rows.map(row => row.slot),
      false,
    )

    return rows.map(({ item, slot }) => {
      const { discord, requester } = resolveSlot(slot, links)

      return Object.assign({}, item, {
        lastDiscordRequester: discord,
        lastRequester: requester,
      })
    })
  }

  /**
   * The forward direction only, over audit rows - `discordActor` ->
   * `actor`, with the same handle refresh.
   *
   * `origin` is deliberately **not** rewritten: it records how the action
   * arrived, which is a fact about the past that linking an account cannot
   * change. A resolved row is therefore an `origin: 'discord'` entry that
   * also names a lilnas actor, which is exactly what it is. Nothing is
   * written back - the DB's `audit_log_origin_matches_actor` CHECK still
   * forbids that pairing on a *row*, and it is never violated because this
   * only ever touches the object on the wire.
   */
  async resolveAuditEntries<T extends ResolvableAuditEntry>(
    entries: readonly T[],
  ): Promise<T[]> {
    const rows = entries.map(entry => ({
      entry,
      slot: { discord: entry.discordActor, requester: entry.actor },
    }))

    const links = await this.loadLinks(
      rows.map(row => row.slot),
      false,
    )

    return rows.map(({ entry, slot }) => {
      const { discord, requester } = resolveSlot(slot, links)

      return Object.assign({}, entry, {
        actor: requester,
        discordActor: discord,
      })
    })
  }

  /**
   * One pass over the batch collects the keys for **both** directions, and
   * one `Promise.all` issues them together - so a page costs a single round
   * of (mostly cached) lookups rather than one round per direction.
   *
   * `withLinked` is false for the shapes that have nowhere to put the
   * reverse answer, which is what keeps their pages free of the per-
   * requester lookup entirely.
   */
  private async loadLinks(
    slots: readonly AttributionSlot[],
    withLinked: boolean,
  ): Promise<LinkMaps> {
    const discordUserIds = new Set<string>()
    const lilnasUserIds = new Set<string>()

    for (const slot of slots) {
      // The two arms are exclusive because the underlying rows are: the
      // `jobs_origin_matches_requester` / `audit_log_origin_matches_actor`
      // CHECKs make exactly one of the pair non-null. A slot needing the
      // forward direction gets its reverse answer out of the *same*
      // envelope (see `resolveSlot`), so it never needs a `u:` key of its
      // own.
      if (slot.discord && !slot.requester) {
        discordUserIds.add(slot.discord.discordUserId)
      } else if (withLinked && slot.requester) {
        lilnasUserIds.add(slot.requester.userId)
      }
    }

    const [byDiscordUserId, byLilnasUserId] = await Promise.all([
      lookupAll(discordUserIds, id =>
        this.discordLinkService.resolveDiscordUser(id),
      ),
      lookupAll(lilnasUserIds, id =>
        this.discordLinkService.resolveLilnasUser(id),
      ),
    ])

    return { byDiscordUserId, byLilnasUserId }
  }
}

/**
 * The pure half: given every link answer the batch fetched, decide one
 * slot's three fields. No I/O, so the mapping pass is synchronous and every
 * branch is directly testable.
 */
function resolveSlot(
  slot: AttributionSlot,
  links: LinkMaps,
): ResolvedAttribution {
  // Forward: submitted over Discord, attributed to nobody yet.
  if (slot.discord && !slot.requester) {
    const link = links.byDiscordUserId.get(slot.discord.discordUserId)
    const identity = link?.identity ?? null
    const user = link?.user ?? null

    return {
      // Auth's roster spells the handle `username`; the wire spells it
      // `discordUsername`. Falls back to the stored pair verbatim when auth
      // has never seen this account (or could not be reached), which is the
      // pre-feature rendering.
      discord: identity
        ? {
            discordUserId: slot.discord.discordUserId,
            discordUsername: identity.username,
          }
        : slot.discord,
      // The reverse direction, for free: the `d:` envelope already carried
      // the roster identity, and when `user` is set that identity *is* the
      // account linked to the requester being resolved one line down. No
      // second lookup, no `u:` cache entry.
      linked:
        identity && user
          ? {
              discordUserId: identity.discordUserId,
              discordUsername: identity.username,
            }
          : null,
      requester: user ? { email: user.email, userId: user.userId } : null,
    }
  }

  // Reverse: attributed to a lilnas user, who may have a linked account.
  // A miss (unlinked, or `withLinked: false`) leaves `linked` null, which is
  // how every row rendered before this feature.
  if (slot.requester) {
    const identity =
      links.byLilnasUserId.get(slot.requester.userId)?.identity ?? null

    return {
      discord: slot.discord,
      linked: identity
        ? {
            discordUserId: identity.discordUserId,
            discordUsername: identity.username,
          }
        : null,
      requester: slot.requester,
    }
  }

  // Neither half present - a service caller, or a masked row. Untouched.
  return { discord: slot.discord, linked: null, requester: null }
}

/**
 * Resolves every key in one id space concurrently into a lookup map. The
 * `Set` is the per-batch dedupe: twenty jobs from one Discord user cost one
 * lookup, not twenty.
 */
async function lookupAll(
  keys: ReadonlySet<string>,
  lookup: (key: string) => Promise<DiscordLinkLookupResponse>,
): Promise<Map<string, DiscordLinkLookupResponse>> {
  const entries = await Promise.all(
    [...keys].map(async key => [key, await lookup(key)] as const),
  )

  return new Map(entries)
}
