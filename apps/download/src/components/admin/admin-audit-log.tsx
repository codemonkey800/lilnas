import { cns } from '@lilnas/utils/cns'
import type { AuditLogEntry } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import {
  LINKED_DISCORD_TITLE,
  linkedDiscordLabel,
} from 'src/components/activity/activity-requester'
import { DiscordIdentityMark } from 'src/components/activity/discord-identity-mark'
import { Card } from 'src/components/ui/card'
import {
  AUDIT_ACTION_PHRASES,
  auditActorLabel,
  auditLevel,
  describeAuditTarget,
  formatAuditMetadata,
} from 'src/lib/admin-audit'
import type { AdminFilters } from 'src/lib/admin-filters'
import { adminHref } from 'src/lib/admin-filters'
import type { StatusTone } from 'src/lib/format'
import { formatRelative, UNKNOWN_VALUE } from 'src/lib/format'

/**
 * The level column's ink. `Chip`'s tones carry a border and a fill, which this
 * column does not want — `admin-dashboard.pug` writes the level as bare
 * coloured text (`tone: 'text-ok'`) — so the tone vocabulary is mapped to plain
 * text colours here rather than reused wholesale.
 */
const LEVEL_TONES: Record<StatusTone, string> = {
  bad: 'text-bad',
  mute: 'text-ink-4',
  ok: 'text-ok',
  uv: 'text-uv',
  warn: 'text-warn',
}

/**
 * One line. Stacked at 390px (`admin-dashboard.pug`'s mobile frame) and a row
 * of columns above it (the desktop one); `sm:contents` is what lets the time
 * and level share a line on the narrow layout and become two of those columns
 * on the wide one without rendering the row twice.
 *
 * ⚠️ **Flex, not `grid-cols-[70px_72px_1fr]`.** The actor is now a piece of
 * *identity* whose width depends on which of three shapes it took — a service
 * word, an email, or a Discord handle followed by a
 * {@link DiscordIdentityMark} — and a fixed track sized for the narrowest of
 * those clips the widest into the action text beside it. That collision is the
 * one `discord-attribution.pug` calls out by name, and its fix is the one taken
 * here: size the actor to its content and let the action text, which has a
 * whole sentence's worth of slack, be the thing that gives way. The time and
 * level keep their exact `70px`/`72px` widths as `sm:w-*` so every row's
 * columns still line up.
 */
const ROW = cns(
  'flex flex-col gap-1 rounded-xs px-2.5 py-[9px] font-mono text-mono-sm',
  'transition-colors duration-[120ms] ease-uv hover:bg-surface-2',
  'sm:flex-row sm:items-baseline sm:gap-3 sm:py-[7px]',
)

const TIME = 'tabular-nums text-ink-4 sm:w-[70px] sm:shrink-0'

const LEVEL = cns(
  'text-[10px] font-semibold tracking-[0.08em]',
  'sm:w-[72px] sm:shrink-0',
)

/** Everything the row says about the action, stacked over its metadata. */
const BODY = 'flex min-w-0 flex-col gap-1 sm:flex-1'

/**
 * The one-line sentence: who, then what. `flex-wrap` is what stands in for the
 * plain text flow this used to be — an actor too wide for the line pushes the
 * action onto the next one rather than off the card.
 */
const SENTENCE = 'flex min-w-0 flex-wrap items-baseline gap-x-1.5'

/**
 * The actor, sized to whichever identity it turned out to hold. `shrink-0` is
 * the half of the fix that matters: it is what makes the action text — not the
 * handle, and not the 12px mark beside it — absorb a narrow column.
 *
 * `items-baseline` rather than `AdminActor`'s `items-center`, because this row
 * is a run of mono text whose baselines line up across all three columns; a
 * centred run would sit a couple of pixels off the action text beside it.
 */
const ACTOR = 'flex shrink-0 items-baseline gap-1'

/** `min-w-0 flex-auto` — the column that yields. See {@link ACTOR}. */
const WHAT = 'min-w-0 flex-auto text-ink-3'

const METADATA_SUMMARY = cns(
  'cursor-pointer text-[10px] tracking-[0.08em] uppercase text-ink-4',
  'transition-colors duration-200 ease-uv hover:text-ink-3',
)

const ACTOR_LINK =
  'text-ink-2 transition-colors duration-200 ease-uv hover:text-ink hover:underline'

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
        <span className="text-ink-4" title={LINKED_DISCORD_TITLE}>
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
  if (entries.length === 0) {
    return (
      <Card sunk className="px-4 py-4">
        <p className="font-mono text-mono-sm text-ink-4">
          {UNKNOWN_VALUE} nothing has been recorded yet
        </p>
      </Card>
    )
  }

  return (
    <Card sunk className="px-2.5 py-1">
      <ol aria-label="Audit log" className="flex flex-col stagger">
        {entries.map(entry => {
          const level = auditLevel(entry.action)
          const target = describeAuditTarget(entry)
          const metadata = formatAuditMetadata(entry.metadata)

          return (
            <li className={ROW} key={entry.id}>
              <span className="flex items-baseline gap-2.5 sm:contents">
                <span className={TIME} title={entry.createdAt}>
                  {formatRelative(entry.createdAt, now)}
                </span>
                <span className={cns(LEVEL, LEVEL_TONES[level.tone])}>
                  {level.label}
                </span>
              </span>
              <span className={BODY}>
                <span className={SENTENCE}>
                  <AuditActor entry={entry} filters={filters} />
                  <span className={WHAT}>
                    {AUDIT_ACTION_PHRASES[entry.action]}
                    {target === null ? null : (
                      <span className="text-ink-4"> · {target}</span>
                    )}
                  </span>
                </span>
                {metadata === null ? null : (
                  <details>
                    <summary className={METADATA_SUMMARY}>metadata</summary>
                    <pre className="mt-1 overflow-x-auto rounded-xs bg-surface px-2.5 py-2 text-[11px] leading-[1.5] text-ink-3">
                      {metadata}
                    </pre>
                  </details>
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
