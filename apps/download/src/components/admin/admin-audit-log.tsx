import { Badge, Panel, PanelHead, Table } from '@lilnas/ui'
import type { AuditLogEntry } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import {
  LINKED_DISCORD_TITLE,
  linkedDiscordLabel,
} from 'src/components/activity/activity-requester'
import { DiscordIdentityMark } from 'src/components/activity/discord-identity-mark'
import {
  AUDIT_ACTION_PHRASES,
  auditActorLabel,
  auditLevel,
  describeAuditTarget,
  formatAuditMetadata,
} from 'src/lib/admin-audit'
import type { AdminFilters } from 'src/lib/admin-filters'
import { adminHref } from 'src/lib/admin-filters'
import { formatRelative } from 'src/lib/format'

/**
 * The one-line sentence: who, then what. `flex-wrap` is what stands in for the
 * plain text flow — an actor too wide for the line pushes the action onto the
 * next one rather than off the panel.
 */
const SENTENCE = 'flex min-w-0 flex-wrap items-baseline gap-x-1.5'

/**
 * The actor, sized to whichever identity it turned out to hold. `shrink-0` is
 * what makes the action text — not the handle, and not the 12px mark beside
 * it — absorb a narrow column.
 */
const ACTOR = 'flex shrink-0 items-baseline gap-1'

/** `min-w-0 flex-auto` — the column that yields. See {@link ACTOR}. */
const WHAT = 'min-w-0 flex-auto text-ink-3'

const METADATA_SUMMARY =
  'cursor-pointer text-cap text-ink-3 transition-colors duration-200 ease-standard hover:text-ink-2'

const ACTOR_LINK =
  'text-ink-2 transition-colors duration-200 ease-standard hover:text-ink hover:underline'

type AuditActorProps = {
  entry: AuditLogEntry
  /** The filter the page is at, so an actor link can extend it. */
  filters: AdminFilters
}

/**
 * Who the row says did the thing.
 *
 * ⚠️ **Deliberately not `AdminActor`.** That component answers the same
 * question for the history table, where an actor is an avatar, a name, a
 * profile glyph and — for a service — an `MChip`. This is a mono log line, and
 * the service case here has to stay the bare `auditActorLabel` word it has
 * always been. What *is* shared is the vocabulary: the strings come from
 * `activity-requester.tsx` and the mark from `discord-identity-mark.tsx`, so
 * the same fact is spelled the same way on every surface that renders it.
 *
 * The three readings of the pair, in the order they are checked:
 *
 * 1. **`actor` set** — a person, whether they arrived over the web or over
 *    Discord with a linked account. A resolved Discord row keeps its
 *    `discordActor` alongside the email (`resolveAuditEntries` fills one
 *    without clearing the other), and *that pairing is only ever produced by
 *    resolution* — `audit_log_origin_matches_actor` forbids a stored row from
 *    holding both — so it can be read as "the account this person is linked
 *    to" and written beside the email exactly as `AdminActor` writes it. Inert
 *    text, never the mark: the mark is a disclosure affordance for an identity
 *    nobody has claimed.
 * 2. **`discordActor` only** — an unlinked Discord action. ⚠️ This is the case
 *    the page used to get wrong: `actor` is `null` because no lilnas account
 *    claims that snowflake, and falling through to `auditActorLabel` printed
 *    `unattributed web request` over an action a real person took.
 * 3. **Neither** — the genuine service null, which keeps its word unchanged.
 */
function AuditActor({ entry, filters }: AuditActorProps): JSX.Element {
  const { actor, discordActor } = entry

  if (actor === null) {
    if (discordActor === null) {
      return (
        <span className="shrink-0 text-ink-2">
          {auditActorLabel(entry.origin)}
        </span>
      )
    }

    return (
      <span className={ACTOR}>
        {/*
          No link on the handle. Both of this page's targets are email-keyed —
          `?requester=` filters on an email — and an unlinked snowflake has
          none. The mark is the only affordance it gets, and what it discloses
          is the id an admin pastes into `apps/auth` to link the account.
        */}
        <span className="text-ink-2">{discordActor.discordUsername}</span>
        <DiscordIdentityMark
          discordUserId={discordActor.discordUserId}
          discordUsername={discordActor.discordUsername}
        />
      </span>
    )
  }

  return (
    <span className={ACTOR}>
      <a
        className={ACTOR_LINK}
        href={adminHref({ ...filters, requester: actor.email })}
      >
        {actor.email}
      </a>
      {discordActor === null ? null : (
        <span className="text-ink-3" title={LINKED_DISCORD_TITLE}>
          {linkedDiscordLabel(discordActor.discordUsername)}
        </span>
      )}
    </span>
  )
}

export type AdminAuditLogProps = {
  entries: readonly AuditLogEntry[]
  filters: AdminFilters
  /** The instant every relative stamp on the page is measured against. */
  now: number
}

/**
 * The audit trail — `GET /download/admin/audit-log`, unmasked.
 *
 * ## `actor` is `null` for the service, not for a person
 *
 * ⚠️ An audit row's `actor` is `null` when the caller had no forwarded identity
 * — tdr-bot, the yt-dlp updater — and `origin` says whether that was expected
 * (`'service'`) or is itself the finding (`'web'`: a browser request that
 * somehow arrived without `X-Forwarded-User`). Rendering either as an anonymous
 * *user* would attribute an action to a person who does not exist, so both go
 * through `auditActorLabel`, which names the service in the first case and says
 * out loud that identity went missing in the second.
 *
 * ⚠️ Since plan 017 there is a **third** null: an `origin: 'discord'` action by
 * an account no lilnas user has claimed, which a person did take. `AuditActor`
 * separates the two on `discordActor`.
 *
 * ## `metadata` has no schema, on purpose
 *
 * ⚠️ `AuditLogEntrySchema` types it `Record<string, unknown>` because it is
 * "per-action detail rendered as key/value pairs, never branched on". It is
 * therefore rendered as formatted JSON behind a `<details>` — readable when you
 * want it, out of the way when you don't, and requiring no frontend change for
 * an action that starts recording something new. A row whose metadata is `null`
 * or `{}` gets no disclosure at all rather than one that opens onto nothing.
 *
 * ## Deviation from the mockup's clock
 *
 * `admin-dashboard.mjs` stamps each line `15:42:08`. That is a wall clock, and
 * rendering one means picking a timezone: UTC would quietly mislabel every row
 * for a reader who is not in it, and the viewer's own zone differs between the
 * server render and the hydration, which is a mismatch on the one column whose
 * whole job is to be exact. So the column is the same `formatRelative` every
 * other list in this app uses, measured against one pinned server instant, with
 * the exact ISO timestamp on the element's `title`.
 */
export function AdminAuditLog({
  entries,
  filters,
  now,
}: AdminAuditLogProps): JSX.Element {
  return (
    <Panel>
      <PanelHead title="Audit log" />
      {entries.length === 0 ? (
        <p className="px-4 py-5 text-sm text-ink-3">
          Nothing has been recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table.Root aria-label="Audit log">
            <Table.Head>
              <Table.Row>
                <Table.Th className="pl-4" scope="col">
                  Time
                </Table.Th>
                <Table.Th scope="col">Action</Table.Th>
                <Table.Th className="pr-4" scope="col">
                  What
                </Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {entries.map(entry => {
                const level = auditLevel(entry.action)
                const target = describeAuditTarget(entry)
                const metadata = formatAuditMetadata(entry.metadata)

                return (
                  <Table.Row key={entry.id}>
                    <Table.Td
                      className="pl-4 align-top whitespace-nowrap text-ink-3"
                      mono
                    >
                      <span title={entry.createdAt}>
                        {formatRelative(entry.createdAt, now)}
                      </span>
                    </Table.Td>
                    <Table.Td className="align-top">
                      <Badge tone={level.tone}>{level.label}</Badge>
                    </Table.Td>
                    <Table.Td className="pr-4 align-top">
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className={SENTENCE}>
                          <AuditActor entry={entry} filters={filters} />
                          <span className={WHAT}>
                            {AUDIT_ACTION_PHRASES[entry.action]}
                            {target === null ? null : (
                              <span className="text-ink-3"> · {target}</span>
                            )}
                          </span>
                        </span>
                        {metadata === null ? null : (
                          <details>
                            <summary className={METADATA_SUMMARY}>
                              Metadata
                            </summary>
                            <pre className="mt-1 overflow-x-auto rounded-xs bg-bg-sunk px-2.5 py-2 font-mono text-mono-sm text-ink-3">
                              {metadata}
                            </pre>
                          </details>
                        )}
                      </span>
                    </Table.Td>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table.Root>
        </div>
      )}
    </Panel>
  )
}
