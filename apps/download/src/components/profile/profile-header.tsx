import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { PROFILE_GROUP_LABEL } from 'src/components/profile/profile-page-shell'
import { Avatar } from 'src/components/ui/avatar'
import { Card } from 'src/components/ui/card'
import { Chip } from 'src/components/ui/chip'
import { formatRelative, initials } from 'src/lib/format'

/**
 * `Jun 14, 2025`. Fixed locale and fixed time zone for the same reason the
 * trend's day labels are: this is rendered on the server and shipped as HTML,
 * so a client-resolved locale would rewrite it on hydration.
 *
 * The *first* download is an absolute date and the *last* is relative
 * (`2m ago`), which is `profile.pug`'s own split and the right one: when someone
 * started using the service is a fact about the past, and when they last did is
 * a fact about now.
 */
const FIRST_DOWNLOAD_DATE = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
})

/** What the header's second line says for a profile with no jobs at all. */
export const NO_DOWNLOADS_YET = 'No downloads yet'

/**
 * 52px, the one size this mark is ever drawn at. Spelled as utilities rather
 * than an `AvatarSize` because `md` is 30px and this is the only call site in
 * the app that wants a portrait — `avatar.tsx`'s own doc comment names this
 * exact string as the expected override.
 */
const HEADER_AVATAR = 'h-[52px] w-[52px] text-[18px]'

export type ProfileHeaderProps = {
  /** The resolved target, echoed by `ProfileResponse.user.email`. */
  email: string
  /** ISO-8601, or `null` when this person has never downloaded anything. */
  firstDownloadAt: string | null
  /** ISO-8601, or `null`. Always `null` exactly when `firstDownloadAt` is. */
  lastDownloadAt: string | null
  /** The instant `lastDownloadAt` is measured against, pinned by the page. */
  now: number
  /** Whether this profile is the viewer's own — the ring and the `you` chip. */
  you: boolean
}

/**
 * Who this profile is about: the mark, the email, and the span of their
 * activity.
 *
 * ⚠️ The mark goes **dashed and initial-less for an empty profile**, following
 * `profile.pug`'s `hidden: p.empty`. `Avatar`'s `hidden` normally means
 * "attribution is masked", and this is the one place it is used for "there is
 * nothing here yet" instead — the reading is the same to a viewer (a circle with
 * no person in it) and there genuinely is no history to draw initials from. The
 * email is right beside it, so nothing is being concealed.
 */
export function ProfileHeader({
  email,
  firstDownloadAt,
  lastDownloadAt,
  now,
  you,
}: ProfileHeaderProps): JSX.Element {
  const empty = firstDownloadAt === null

  return (
    <div className="mb-6 flex items-center gap-4">
      {empty ? (
        <Avatar className={cns(HEADER_AVATAR)} hidden />
      ) : (
        <Avatar
          className={cns(HEADER_AVATAR)}
          initials={initials(email)}
          ring={you}
        />
      )}
      <div className="min-w-0">
        {/*
          A `<p>`, not a heading: the page's own `<h1>` already names the view,
          and the mockup draws these at the same size because the email is the
          subject rather than a second title.
        */}
        <p className="mb-1 flex flex-wrap items-center gap-2 text-h1">
          {/*
            ⚠️ `break-all`, which `profile.pug` has no need of: its sample
            address is `jeremy@lilnas.io`, and the real one this deployment
            reports is `jeremyasuncion808@gmail.com` — 23px of unbreakable
            local part is wider than a 390px viewport, and a bare text node in
            a flex row cannot shrink below its content. Without this the email
            runs off the right edge of a phone.
          */}
          <span className="break-all">{email}</span>
          {you ? (
            <Chip className="h-5 text-[10px]" label="you" tone="uv" />
          ) : null}
        </p>
        <p className="font-mono text-mono-sm text-ink-4">
          {firstDownloadAt === null || lastDownloadAt === null
            ? NO_DOWNLOADS_YET
            : `First download ${FIRST_DOWNLOAD_DATE.format(
                new Date(firstDownloadAt),
              )} · last ${formatRelative(lastDownloadAt, now)}`}
        </p>
      </div>
    </div>
  )
}

export type LifetimeTileProps = {
  /** `sumProfileTotals(profile.totalsByType)` — there is no `totalJobs`. */
  total: number
}

/**
 * The headline number, styled like `admin-dashboard.pug`'s `statTile` — one
 * tile rather than the whole mixin, since a profile only ever needs the one.
 *
 * `Card`'s own `p-5` is replaced at the call site, which is exactly what the
 * mockup does (`px-5 pt-[18px] pb-5`) and what `cns` is there to resolve.
 */
export function LifetimeTile({ total }: LifetimeTileProps): JSX.Element {
  return (
    <Card className="mb-6 flex w-fit min-w-[168px] flex-col gap-[7px] px-5 pt-[18px] pb-5">
      <span className={cns(PROFILE_GROUP_LABEL)}>lifetime downloads</span>
      <span
        className={cns(
          'font-mono text-[32px] leading-[1.1] font-semibold',
          'tracking-[-0.02em] tabular-nums',
        )}
      >
        {total}
      </span>
    </Card>
  )
}
