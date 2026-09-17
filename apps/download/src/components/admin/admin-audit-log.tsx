import { cns } from '@lilnas/utils/cns'
import type { AuditLogEntry } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

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
 * One line. Stacked at 390px (`admin-dashboard.pug`'s mobile frame) and a
 * three-column grid above it (the desktop one); `sm:contents` is what lets the
 * time and level share a line on the narrow layout and become two grid cells on
 * the wide one without rendering the row twice.
 */
const ROW = cns(
  'flex flex-col gap-1 rounded-xs px-2.5 py-[9px] font-mono text-mono-sm',
  'transition-colors duration-[120ms] ease-uv hover:bg-surface-2',
  'sm:grid sm:grid-cols-[70px_72px_1fr] sm:items-baseline sm:gap-3 sm:py-[7px]',
)

const LEVEL = 'text-[10px] font-semibold tracking-[0.08em]'

const METADATA_SUMMARY = cns(
  'cursor-pointer text-[10px] tracking-[0.08em] uppercase text-ink-4',
  'transition-colors duration-200 ease-uv hover:text-ink-3',
)

const ACTOR_LINK =
  'text-ink-2 transition-colors duration-200 ease-uv hover:text-ink hover:underline'

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
          const actorHref =
            entry.actor === null
              ? undefined
              : adminHref({ ...filters, requester: entry.actor.email })

          return (
            <li className={ROW} key={entry.id}>
              <span className="flex items-baseline gap-2.5 sm:contents">
                <span
                  className="tabular-nums text-ink-4"
                  title={entry.createdAt}
                >
                  {formatRelative(entry.createdAt, now)}
                </span>
                <span className={cns(LEVEL, LEVEL_TONES[level.tone])}>
                  {level.label}
                </span>
              </span>
              <span className="min-w-0 text-ink-3">
                {entry.actor === null || actorHref === undefined ? (
                  <span className="text-ink-2">
                    {auditActorLabel(entry.origin)}
                  </span>
                ) : (
                  <a className={ACTOR_LINK} href={actorHref}>
                    {entry.actor.email}
                  </a>
                )}{' '}
                {AUDIT_ACTION_PHRASES[entry.action]}
                {target === null ? null : (
                  <span className="text-ink-4"> · {target}</span>
                )}
                {metadata === null ? null : (
                  <details className="mt-1">
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
