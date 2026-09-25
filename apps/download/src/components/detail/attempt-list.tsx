'use client'

import { cns } from '@lilnas/utils/cns'
import type { DownloadJob, ShowScope } from '@lilnas/utils/download/types'
import {
  DownloadType,
  isTerminalDownloadJobStatus,
} from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'
import { useId, useTransition } from 'react'

import {
  discordAvatarTitle,
  jobUpstreamSource,
  LINKED_DISCORD_TITLE,
  linkedDiscordLabel,
  MASKED_REQUESTER_LABEL,
} from 'src/components/activity/activity-requester'
import { DiscordIdentityMark } from 'src/components/activity/discord-identity-mark'
import type { ImportDialogActions } from 'src/components/detail/import-dialog'
import { ImportDialog } from 'src/components/detail/import-dialog'
import type { JobAction } from 'src/components/detail/job-actions'
import {
  ACTION_BUTTON,
  ACTION_SPECS,
  ActionRow,
} from 'src/components/detail/job-actions'
import type {
  Handoff,
  JobActionKey,
  JobProgress,
} from 'src/components/detail/job-state'
import {
  FINISHING_LABEL,
  handoffDetail,
  jobActionState,
  jobHandoff,
  jobProgress,
  jobStatusLabel,
  jobTransferLine,
} from 'src/components/detail/job-state'
import { Avatar } from 'src/components/ui/avatar'
import { Button } from 'src/components/ui/button'
import { Card } from 'src/components/ui/card'
import { Chip } from 'src/components/ui/chip'
import { StateLine } from 'src/components/ui/state-line'
import { Bar, Dot } from 'src/components/ui/status'
import { formatRelative, initials, statusTone } from 'src/lib/format'

/**
 * The actions an in-flight attempt can offer. `watch` and `save` are not
 * here: they belong to a *completed* job, which is terminal and so never an
 * attempt card, and on the new pages they are media actions in the header.
 */
const ATTEMPT_ACTION_KEYS: ReadonlySet<JobActionKey> = new Set<JobActionKey>([
  'cancel',
  'import',
  'pause',
  'resume',
  'retry',
])

/** `ACTION_SPECS`, in its order, narrowed to what an attempt card offers. */
const ATTEMPT_ACTION_SPECS = ACTION_SPECS.filter(spec =>
  ATTEMPT_ACTION_KEYS.has(spec.key),
)

/**
 * ⚠️ `onCancel` and `onPause` are real `<section>` attributes (React's
 * `DOMAttributes` puts the media events on every element), so they are removed
 * before ours take those names. Left in, each intersects to
 * `ReactEventHandler<HTMLElement> & JobAction` and no plain server action is
 * assignable to either.
 */
export type AttemptListProps = Omit<
  ComponentPropsWithoutRef<'section'>,
  'children' | 'onCancel' | 'onPause'
> & {
  /**
   * The three importer actions, handed to the `ImportDialog` on a
   * `needs_attention` attempt. Omitted renders no Import control.
   */
  imports?: ImportDialogActions
  /**
   * Every job for the media key, in any order — the list sorts newest first
   * itself. `MediaDetailResponse.jobs` verbatim is fine.
   */
  jobs: readonly DownloadJob[]
  /** The heading. Defaults to the mockups' `Attempts`. */
  label?: string
  /** The instant every stamp is measured against, pinned once by the page. */
  now: Date | number
  onCancel?: JobAction
  onPause?: JobAction
  onResume?: JobAction
  onRetry?: JobAction
  /**
   * Whether the newest attempt, when it failed or was cancelled, offers Retry
   * on its history row. Omitted offers none.
   *
   * ⚠️ A page decides this from the **media** state, not from the job — pass
   * it when the title is `absent` or `wanted`. A failed attempt says nothing
   * about whether the file is there: *Cars* had a failed newest job over a
   * perfectly playable movie, and a Retry there would re-grab a title that is
   * already on disk. Only the newest attempt ever carries it — retrying an
   * older failure that a later attempt already superseded is not a thing
   * anybody means.
   */
  retryable?: boolean
}

/** Newest `createdAt` first. A copy — `jobs` is the page's, not ours. */
function newestFirst(jobs: readonly DownloadJob[]): DownloadJob[] {
  return [...jobs].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )
}

/**
 * Every download attempt at a title — the in-flight ones as highlighted cards
 * with their own progress and controls, the finished ones as a compact
 * history under them.
 *
 * Ports the `attemptsList`, `attemptInFlight` and `attemptLine` mixins from
 * `movie-detail.pug`, `show-detail.pug` and `video-detail.pug`. The chip at
 * the top of the page is
 * `MediaStatus`'s and reads the media; this list reads only jobs, so neither
 * can talk the other into a wrong answer.
 *
 * ⚠️ Deviation: the mockups draw one in-flight card. A show can have several
 * attempts in flight at once — a season grab and an episode grab — and each is
 * its own piece of work with its own cancel, so every non-terminal job gets
 * its own card, newest first, each carrying its own scope.
 *
 * Renders `null` for an empty list — the chip above already says "not
 * downloaded", and a heading over nothing says less than no heading.
 */
export function AttemptList({
  className,
  imports,
  jobs,
  label = 'Attempts',
  now,
  onCancel,
  onPause,
  onResume,
  onRetry,
  retryable = false,
  ...props
}: AttemptListProps): JSX.Element | null {
  const headingId = useId()

  if (jobs.length === 0) {
    return null
  }

  const sorted = newestFirst(jobs)
  const inFlight = sorted.filter(
    job => !isTerminalDownloadJobStatus(job.status),
  )
  const terminal = sorted.filter(job => isTerminalDownloadJobStatus(job.status))
  const handlers: Partial<Record<JobActionKey, JobAction | undefined>> = {
    cancel: onCancel,
    pause: onPause,
    resume: onResume,
    retry: onRetry,
  }
  // Only the newest attempt overall, and only while nothing newer exists —
  // which `sorted[0]` being terminal already guarantees. `jobActionState`
  // still has the last word on which statuses a retry is legal from.
  const newest = sorted[0]
  const retryId =
    retryable &&
    onRetry &&
    newest &&
    jobActionState(newest.status, 'retry') === 'offered'
      ? newest.id
      : null

  return (
    <section
      {...props}
      aria-labelledby={headingId}
      className={cns('flex flex-col gap-3', className)}
    >
      <h2 className={cns('text-h2')} id={headingId}>
        {label}
      </h2>
      {inFlight.map(job => (
        <AttemptCard
          handlers={handlers}
          imports={imports}
          job={job}
          key={job.id}
        />
      ))}
      {terminal.length > 0 ? (
        <Card className={cns('px-[14px] py-1 sm:px-4')} sunk>
          {terminal.map(job => (
            <AttemptLine
              job={job}
              key={job.id}
              now={now}
              onRetry={job.id === retryId ? onRetry : undefined}
            />
          ))}
        </Card>
      ) : null}
    </section>
  )
}

/**
 * `show-detail.pug`'s "Season 3, episode 6" — which part of a show an attempt
 * is for, so two in-flight attempts at one series can be told apart. `null`
 * for a movie, a video or a series-wide grab.
 */
export function attemptScopeLabel(scope: ShowScope | undefined): string | null {
  if (scope?.seasonNumber === undefined) {
    return null
  }

  return scope.episodeNumber === undefined
    ? `Season ${scope.seasonNumber}`
    : `Season ${scope.seasonNumber}, episode ${scope.episodeNumber}`
}

type AttemptCardProps = {
  handlers: Partial<Record<JobActionKey, JobAction | undefined>>
  imports?: ImportDialogActions
  job: DownloadJob
}

/**
 * `attemptInFlight`: the attempt's status chip and percentage over a bar, a
 * note, the time estimate (or, once the bytes are down, what happens next),
 * and whatever this status lets you do.
 *
 * A video's card is `video-detail.pug`'s `progress` mixin: yt-dlp's counter
 * (`fragment 4 of 9`) between the chip and the percentage, and the transfer
 * line (`412 MB / 640 MB · 3.1 MB/s · ~2m left`) under the bar. A movie's or
 * show's queue entry has a status word but no counter and no bytes, so its
 * card keeps the bare `~hh:mm:ss left`.
 *
 * Its own component so each card owns its own transition — pausing one of two
 * in-flight attempts must not grey out the other's buttons.
 */
function AttemptCard({
  handlers,
  imports,
  job,
}: AttemptCardProps): JSX.Element {
  const [pending, startTransition] = useTransition()

  const tone = statusTone(job.status)
  // Derived from the tone rather than a second list of statuses: `uv` is the
  // tone of work the machine is actively doing, which is what the breathing
  // dot means.
  const live = tone === 'uv'
  const isVideo = job.media.type === DownloadType.Video
  const progress = jobProgress(job)
  // A video whose total yt-dlp does not know yet: bytes and a rate, but no
  // percentage to draw a bar with.
  const transfer = progress ? null : jobTransferLine(job)
  // Every byte down but not in the library yet: the chip says so, the bar
  // settles, and the spent `~00:00:00 left` gives way to what happens next.
  const handoff = jobHandoff(job.status, progress?.pct)
  const label =
    handoff === 'finishing' ? FINISHING_LABEL : jobStatusLabel(job.status)
  // Only a video's note is a counter. A movie's is Radarr's status word, which
  // the chip already says better.
  const counter = isVideo ? (progress?.note ?? null) : null
  const aside = attemptAside(job, handoff, progress, transfer)
  const note = [attemptScopeLabel(job.scope), job.error]
    .filter(Boolean)
    .join(' — ')

  function run(action: JobAction): void {
    startTransition(async () => {
      await action(job.id)
    })
  }

  const controls = ATTEMPT_ACTION_SPECS.map(spec => {
    const availability = jobActionState(job.status, spec.key)
    if (availability === 'none') {
      return null
    }

    // The dialog owns its own open state, its one fetch and its own pending
    // flag, so the card's transition does not reach it — it would only disable
    // the press that opens a modal, and `import` is never `acknowledged`
    // anyway: nothing moves a job out of `needs_attention` until a human
    // answers.
    if (spec.key === 'import') {
      if (!imports) {
        return null
      }

      return (
        <ImportDialog
          actions={imports}
          className={cns(ACTION_BUTTON)}
          key="import"
          label={spec.label}
          mediaId={job.media.id}
          scope={job.scope}
          title={job.media.title}
          variant={spec.variant}
        />
      )
    }

    const handler = handlers[spec.key]
    if (!handler) {
      return null
    }

    // `acknowledged` is a press the backend already took (`pausing`,
    // `cancelling`): the control stays, inert, rather than vanishing.
    const inert = availability === 'acknowledged' || pending

    return (
      <Button
        aria-disabled={inert || undefined}
        className={cns(ACTION_BUTTON)}
        iconEnd={spec.iconEnd}
        key={spec.key}
        onClick={() => run(handler)}
        variant={spec.variant}
      >
        {spec.label}
      </Button>
    )
  }).filter(Boolean)

  return (
    <Card
      className={cns('border-uv/35 bg-uv-ghost/30 p-4 sm:p-5')}
      data-job-id={job.id}
      data-status={job.status}
    >
      <div className={cns('flex items-center justify-between gap-3')}>
        <Chip className={cns('w-fit')} tone={tone}>
          {live ? <Dot tone="live" /> : null}
          {label}
        </Chip>
        {counter ? (
          <span
            className={cns(
              'min-w-0 flex-1 truncate font-mono text-mono-sm text-ink-3',
            )}
          >
            {counter}
          </span>
        ) : null}
        {progress ? (
          <span
            aria-hidden="true"
            className={cns('font-mono text-mono-sm tabular-nums text-uv-hi')}
          >
            {`${Math.round(progress.pct)}%`}
          </span>
        ) : null}
      </div>
      {progress ? (
        <Bar
          aria-label="Download progress"
          aria-valuetext={
            handoff ? `${Math.round(progress.pct)}%, ${label}` : undefined
          }
          className={cns('mt-3')}
          pct={progress.pct}
          settling={handoff !== null}
        />
      ) : null}
      {note ? <p className={cns('mt-3 text-sm text-ink-3')}>{note}</p> : null}
      {aside ? (
        <p
          className={cns('mt-2 font-mono text-mono-sm tabular-nums text-ink-3')}
        >
          {aside}
        </p>
      ) : null}
      {controls.length > 0 ? (
        <div className={cns('mt-3')}>
          <ActionRow>{controls}</ActionRow>
        </div>
      ) : null}
    </Card>
  )
}

/**
 * The mono line under an attempt's bar, first match wins:
 *
 * - A handoff says what happens next (`handoffDetail`) — nothing for a video,
 *   whose chip already names the step.
 * - A video with a bar reads its transfer and yt-dlp's estimate, which
 *   `formatEta` has already phrased: `412 MB / 640 MB · 3.1 MB/s · ~2m left`.
 * - A movie or show wraps the queue's raw `hh:mm:ss` as `~00:12:00 left`.
 * - A video with bytes but no percentage reads the transfer alone.
 */
function attemptAside(
  job: DownloadJob,
  handoff: Handoff | null,
  progress: JobProgress | null,
  transfer: string | null,
): string | null {
  if (handoff) {
    return handoffDetail(handoff, job.media.type)
  }

  if (!progress) {
    return transfer
  }

  if (job.media.type === DownloadType.Video) {
    return (
      [progress.detail, progress.timeLeft].filter(Boolean).join(' · ') || null
    )
  }

  return progress.timeLeft ? `~${progress.timeLeft} left` : null
}

type AttemptLineProps = {
  job: DownloadJob
  now: Date | number
  /** Set only on the one row `AttemptList` decided may retry. */
  onRetry?: JobAction
}

/** `ACTION_SPECS`' own Retry, so the row's button looks like every other. */
const RETRY_SPEC = ACTION_SPECS.find(spec => spec.key === 'retry')

/**
 * `attemptLine`: a finished attempt — fixed-width status chip, when it ended,
 * who asked, and what went wrong. Otherwise no controls, except Retry on the
 * newest row when `AttemptList`'s `retryable` allows it — at the legend rows'
 * `sm` size, since it sits in a `StateLine` rather than a card.
 */
function AttemptLine({ job, now, onRetry }: AttemptLineProps): JSX.Element {
  const [pending, startTransition] = useTransition()

  function retry(action: JobAction): void {
    startTransition(async () => {
      await action(job.id)
    })
  }

  return (
    <StateLine
      className={cns(
        'flex-col items-start gap-[9px]',
        'sm:flex-row sm:items-center sm:gap-[14px]',
      )}
      data-job-id={job.id}
      data-status={job.status}
    >
      <Chip
        className={cns('sm:w-[108px] sm:justify-center')}
        label={jobStatusLabel(job.status)}
        tone={statusTone(job.status)}
      />
      <span
        className={cns(
          'flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-ink-3',
        )}
      >
        <span className={cns('font-mono text-mono-sm text-ink-4')}>
          {formatRelative(job.completedAt ?? job.createdAt, now)}
        </span>
        <AttemptRequester job={job} />
        {job.error ? (
          <span className={cns('min-w-0 text-bad')}>{job.error}</span>
        ) : null}
      </span>
      {onRetry && RETRY_SPEC ? (
        <Button
          aria-disabled={pending || undefined}
          className={cns(ACTION_BUTTON)}
          iconEnd={RETRY_SPEC.iconEnd}
          onClick={() => retry(onRetry)}
          size="sm"
          variant={RETRY_SPEC.variant}
        >
          {RETRY_SPEC.label}
        </Button>
      ) : null}
    </StateLine>
  )
}

const REQUESTER_AVATAR = 'h-5 w-5 shrink-0 text-[9px]'
const REQUESTER_NAME = 'truncate font-mono text-mono-sm text-ink-3'

/**
 * Who asked for an attempt, masked exactly as `DetailAttribution` masks the
 * header's attribution line: masked first (a dashed avatar and `hidden`, and
 * nothing else — no handle, no snowflake, no mark), then `requester` as the
 * email's local part, then an unlinked `discordRequester` as its handle plus
 * the identity mark. The masking itself happened server-side; this only
 * renders the `null`s it left.
 *
 * An attempt adopted from Radarr's or Sonarr's own UI leaves the same `null`s
 * and is no mask at all, so it reads `Radarr` / `Sonarr` as plain text in the
 * masked branch's place — no avatar and no link, as `DetailAttribution` writes
 * it.
 */
function AttemptRequester({ job }: { job: DownloadJob }): JSX.Element {
  const { discordRequester, linkedDiscord, requester } = job

  if (requester !== null) {
    return (
      <span className={cns('flex min-w-0 items-center gap-1.5')}>
        <Avatar
          className={cns(REQUESTER_AVATAR)}
          initials={initials(requester.email)}
          title={requester.email}
        />
        <span className={cns(REQUESTER_NAME)}>
          {requester.email.split('@')[0] ?? MASKED_REQUESTER_LABEL}
        </span>
        {linkedDiscord === null ? null : (
          <span
            className={cns('truncate font-mono text-mono-sm text-ink-4')}
            title={LINKED_DISCORD_TITLE}
          >
            {linkedDiscordLabel(linkedDiscord.discordUsername)}
          </span>
        )}
      </span>
    )
  }

  if (discordRequester !== null) {
    return (
      <span className={cns('flex min-w-0 items-center gap-1.5')}>
        <Avatar
          className={cns(REQUESTER_AVATAR)}
          initials={initials(discordRequester.discordUsername)}
          title={discordAvatarTitle(discordRequester.discordUsername)}
        />
        <span className={cns(REQUESTER_NAME)}>
          {discordRequester.discordUsername}
        </span>
        <DiscordIdentityMark
          discordUserId={discordRequester.discordUserId}
          discordUsername={discordRequester.discordUsername}
        />
      </span>
    )
  }

  const upstream = jobUpstreamSource(job)

  if (upstream !== undefined) {
    return (
      <span className={cns('font-mono text-mono-sm text-ink-4')}>
        {upstream}
      </span>
    )
  }

  return (
    <span className={cns('flex items-center gap-1.5')}>
      <Avatar
        className={cns(REQUESTER_AVATAR)}
        hidden
        title="Attribution hidden"
      />
      <span className={cns('font-mono text-mono-sm text-ink-4')}>
        {MASKED_REQUESTER_LABEL}
      </span>
    </span>
  )
}
