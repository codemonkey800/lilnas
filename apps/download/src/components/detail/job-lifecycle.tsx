'use client'

import { cns } from '@lilnas/utils/cns'
import type { DownloadJob } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'
import { useTransition } from 'react'

import type { ImportDialogActions } from 'src/components/detail/import-dialog'
import { ImportDialog } from 'src/components/detail/import-dialog'
import type {
  JobAction,
  JobLifecycleLink,
} from 'src/components/detail/job-actions'
import {
  ACTION_BUTTON,
  ACTION_SPECS,
  ActionRow,
} from 'src/components/detail/job-actions'
import type { JobActionKey } from 'src/components/detail/job-state'
import {
  currentJob,
  JOB_LIFECYCLE_EMPTY_LABEL,
  jobActionState,
  jobProgress,
  jobStatusLabel,
} from 'src/components/detail/job-state'
import { ProgressBlock } from 'src/components/detail/progress-block'
import { Button } from 'src/components/ui/button'
import { ButtonLink } from 'src/components/ui/button-link'
import type { ButtonSize } from 'src/components/ui/button-recipe'
import { Card } from 'src/components/ui/card'
import { Chip } from 'src/components/ui/chip'
import { StateLine } from 'src/components/ui/state-line'
import { Dot } from 'src/components/ui/status'
import { formatRelative, statusTone } from 'src/lib/format'

/**
 * Re-exported from their new home in `job-actions.tsx`, which `AttemptList`
 * shares, so every existing `import … from 'job-lifecycle'` keeps working.
 */
export type { JobAction, JobLifecycleLink }

/**
 * ⚠️ `onCancel` and `onPause` are real `<div>` attributes — React's
 * `DOMAttributes` puts the media events on **every** element, not just on
 * `<video>` — so they have to be removed before ours can take those names,
 * exactly as `SaveLocalProps` removes `media` and `part`. Left in, each
 * intersects to `ReactEventHandler<HTMLDivElement> & JobAction` and no plain
 * `(jobId: string) => Promise<void>` server action is assignable to either.
 *
 * Keeping our names is worth the `Omit`: these four are the lifecycle verbs
 * the whole app spells that way, and neither native event has any meaning on
 * this panel's root. `children` is removed because the component composes its
 * own — `extraActions` and `emptyActions` are the slots.
 *
 * ⚠️ `onResume` and `onRetry` need no `Omit`; there is no DOM event by either
 * name. Removing them anyway would be tidier-looking and strictly wrong: an
 * `Omit` of a key the source type does not have is silent, so it would read as
 * a fact about React's types that is not one.
 */
export type JobLifecycleProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'onCancel' | 'onPause'
> & {
  /** Size for every control in the row. Omitted renders the 38px default. */
  actionSize?: ButtonSize
  /**
   * Page-specific controls appended after the lifecycle ones - Delete, Report
   * a problem, Download this release. A slot rather than more props because
   * these are not functions of the job's status.
   */
  extraActions?: ReactNode
  /** Controls offered when there is no job at all. See `emptyNote`. */
  emptyActions?: ReactNode
  /**
   * What the empty state says. Defaults to the movie page's wording; the video
   * page says "Ready to grab whenever."
   */
  emptyNote?: ReactNode
  /**
   * The line beside the chip. Defaults to the job's `error` when it has one,
   * and to nothing otherwise.
   */
  explain?: ReactNode
  /**
   * Whether the title still has a file on disk, straight through to
   * `currentJob`. Omitted trusts the newest job's status unconditionally -
   * the right default for a video job, which has no file signal of its own to
   * reconcile against. A movie/show page passes its own `hasFile`/`hasFiles`
   * so a stale `Completed` job left behind by a delete renders as no job
   * rather than a file that is no longer there.
   */
  hasFile?: boolean
  /**
   * The three importer actions. Omitted renders no Import control, like a
   * missing `onCancel`.
   */
  imports?: ImportDialogActions
  /**
   * `MediaDetailResponse.jobs` verbatim - **every** job for the media key,
   * newest first. The panel picks its own job itself (`currentJob`); the rest
   * are history, which `JobHistory` renders from the same unsliced list.
   */
  jobs: readonly DownloadJob[]
  /** Replaces the derived `queueSnapshot` percentage - e.g. a season's own. */
  progressPct?: number | null
  /** Replaces the mono line under the bar - e.g. `'14 of 24 episodes'`. */
  progressDetail?: ReactNode
  /** Replaces the mono annotation left of the percentage. */
  progressNote?: ReactNode
  onCancel?: JobAction
  onPause?: JobAction
  onResume?: JobAction
  onRetry?: JobAction
  /** Where `Save to device` goes when the job completed. */
  save?: JobLifecycleLink
  /** Where `Watch` goes when the job completed. */
  watch?: JobLifecycleLink
}

/**
 * The current state of a media item's download, and whatever that state lets
 * you do about it - one status chip, a progress block while there is progress
 * to show, and the action row for that status. All three detail pages render
 * this, which is the point: the state table lives in `job-state.ts` and
 * nothing downstream re-derives it.
 *
 * Reconciles `video-detail.pug`'s primary frame (chip, progress card, Pause
 * and Cancel) with the state legend every detail mockup carries in its
 * appendix. The legend rows themselves are documentation harness and are not
 * ported; what they *document* - which action each status offers - is this
 * component's whole job.
 *
 * ⚠️ `'use client'` because the actions are callbacks and the panel owns the
 * in-flight state between a press and the server's answer. Pass server actions
 * straight in: Next serialises a server action reference across the boundary,
 * and `JobAction` takes the job id so nothing needs binding on the server.
 * The pure state table is importable from either side - see `job-state.ts`.
 */
export function JobLifecycle({
  actionSize,
  className,
  emptyActions,
  emptyNote = 'Nothing downloaded yet.',
  explain,
  extraActions,
  hasFile,
  imports,
  jobs,
  onCancel,
  onPause,
  onResume,
  onRetry,
  progressDetail,
  progressNote,
  progressPct,
  save,
  watch,
  ...props
}: JobLifecycleProps): JSX.Element {
  const [pending, startTransition] = useTransition()
  const job = currentJob(jobs, hasFile)

  // A movie sitting in the library that this app never fetched, or a title
  // somebody navigated to from search. Nothing has a status, so nothing in the
  // status table applies - the page supplies the one control that makes sense
  // here, which is "get it".
  if (!job) {
    return (
      <div
        {...props}
        className={cns('flex flex-col gap-[14px]', className)}
        data-empty="true"
      >
        <div className={cns('flex flex-wrap items-center gap-2.5')}>
          <Chip
            className={cns('w-fit')}
            label={JOB_LIFECYCLE_EMPTY_LABEL}
            tone="mute"
          />
          {emptyNote ? (
            <span className={cns('min-w-0 flex-1 text-sm text-ink-3')}>
              {emptyNote}
            </span>
          ) : null}
        </div>
        {emptyActions ? <ActionRow>{emptyActions}</ActionRow> : null}
      </div>
    )
  }

  const tone = statusTone(job.status)
  // The breathing dot marks work the machine is actively doing, which is
  // exactly what the `uv` tone means - derived rather than a second list of
  // statuses to keep in step with `STATUS_TONES`.
  const live = tone === 'uv'
  const note = explain ?? job.error ?? null

  const handlers: Partial<Record<JobActionKey, JobAction | undefined>> = {
    cancel: onCancel,
    pause: onPause,
    resume: onResume,
    retry: onRetry,
  }
  const links: Partial<Record<JobActionKey, JobLifecycleLink | undefined>> = {
    save,
    watch,
  }

  const derived = jobProgress(job)
  const pct = progressPct ?? derived?.pct ?? null
  const barNote = progressNote ?? derived?.note ?? null
  const barDetail =
    progressDetail ?? (derived?.timeLeft ? `~${derived.timeLeft} left` : null)

  function run(action: JobAction, jobId: string): void {
    startTransition(async () => {
      await action(jobId)
    })
  }

  const controls = ACTION_SPECS.map(spec => {
    const availability = jobActionState(job.status, spec.key)
    if (availability === 'none') {
      return null
    }

    // ⚠️ The one control that is not a bound `Button`, and the one the panel's
    // own in-flight state deliberately does not reach: `ImportDialog` owns its
    // open state, its one fetch and its own pending flag, so `inert`/`pending`
    // are not threaded onto its trigger. They would only disable the press
    // that opens a modal, which no lifecycle call in flight has any business
    // doing - and `import` is never `acknowledged` anyway, since nothing
    // upstream moves a job out of `needs_attention` until a human answers.
    if (spec.key === 'import') {
      // No `imports` renders no control, exactly how a missing `onCancel`
      // behaves a few lines below.
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
          // Both off the job itself: the scope is what narrows the request to
          // the season or episode that is actually stuck, and the title is
          // what turns the dialog heading into the mockup's `Import "<title>"`.
          // Neither is new plumbing - `DownloadJob` carries its own `media`.
          scope={job.scope}
          size={actionSize}
          title={job.media.title}
          variant={spec.variant}
        />
      )
    }

    // An action already in flight - the user pressed it, the backend
    // acknowledged by moving the job to `pausing`/`cancelling`, and the
    // control has to say "yes, that is happening" rather than invite a second
    // press or vanish out from under the cursor.
    const inert = availability === 'acknowledged' || pending

    const link = links[spec.key]
    if (link) {
      return (
        <ButtonLink
          aria-disabled={inert || undefined}
          className={cns(ACTION_BUTTON)}
          href={link.href}
          iconEnd={spec.iconEnd}
          key={spec.key}
          rel={link.external ? 'noreferrer' : undefined}
          size={actionSize}
          target={link.external ? '_blank' : undefined}
          variant={spec.variant}
        >
          {spec.label}
        </ButtonLink>
      )
    }

    const handler = handlers[spec.key]
    if (!handler) {
      return null
    }

    return (
      <Button
        aria-disabled={inert || undefined}
        className={cns(ACTION_BUTTON)}
        iconEnd={spec.iconEnd}
        key={spec.key}
        onClick={() => run(handler, job.id)}
        size={actionSize}
        variant={spec.variant}
      >
        {spec.label}
      </Button>
    )
  }).filter(Boolean)

  return (
    <div {...props} className={cns('flex flex-col gap-[14px]', className)}>
      <div className={cns('flex flex-wrap items-center gap-2.5')}>
        <Chip className={cns('w-fit')} tone={tone}>
          {live ? <Dot tone="live" /> : null}
          {jobStatusLabel(job.status)}
        </Chip>
        {note ? (
          <span className={cns('min-w-0 flex-1 text-sm text-ink-3')}>
            {note}
          </span>
        ) : null}
      </div>
      {pct === null ? null : (
        <ProgressBlock detail={barDetail} note={barNote} pct={pct} />
      )}
      {controls.length > 0 || extraActions ? (
        <ActionRow>
          {controls}
          {extraActions}
        </ActionRow>
      ) : null}
    </div>
  )
}

export type JobHistoryProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  /**
   * Whether the title still has a file on disk - the same value passed to the
   * sibling `JobLifecycle`, and for the same reason: they have to agree on
   * which job (if any) the panel above consumed, or this list either repeats
   * it or silently drops it. See `JobLifecycle`'s `hasFile`.
   */
  hasFile?: boolean
  /**
   * The same unsliced `MediaDetailResponse.jobs` the panel gets. The newest is
   * the one `JobLifecycle` is rendering, so it is dropped here - this list is
   * the *prior* attempts.
   *
   * ⚠️ Unless `currentJob` discounted it as stale (a `Completed` job with no
   * `hasFile` to back it) - in which case the panel rendered no job at all,
   * and every entry here, including the newest, is "prior".
   */
  jobs: readonly DownloadJob[]
  /** The eyebrow over the list. */
  label?: string
  /** The instant every stamp is measured against, pinned once by the page. */
  now: number
}

/**
 * Earlier attempts at the same title, under the panel showing the current one.
 *
 * Takes the unsliced list and drops the newest itself, so a page passes
 * `detail.jobs` to both this and `JobLifecycle` and the two cannot disagree
 * about where the boundary is. Renders `null` when there is only one attempt -
 * which is the common case, and an empty "Earlier attempts" heading over
 * nothing is worse than no heading.
 *
 * No hooks and no interactivity; it is a client component only because it
 * shares this module with `JobLifecycle`.
 */
export function JobHistory({
  className,
  hasFile,
  jobs,
  label = 'Earlier attempts',
  now,
  ...props
}: JobHistoryProps): JSX.Element | null {
  const current = currentJob(jobs, hasFile)
  const prior = current ? jobs.filter(job => job.id !== current.id) : jobs

  if (prior.length === 0) {
    return null
  }

  return (
    <div {...props} className={className}>
      <p
        className={cns(
          'mb-2.5 font-mono text-label tracking-[0.11em] uppercase text-ink-4',
        )}
      >
        {label}
      </p>
      <Card className={cns('px-4 py-1')} sunk>
        {prior.map(job => (
          <StateLine key={job.id}>
            <Chip
              className={cns('sm:w-[118px] sm:justify-center')}
              label={jobStatusLabel(job.status)}
              tone={statusTone(job.status)}
            />
            <span
              className={cns(
                'shrink-0 font-mono text-mono-sm tabular-nums text-ink-4',
              )}
            >
              {formatRelative(job.createdAt, now)}
            </span>
            {job.error ? (
              <span
                className={cns(
                  'min-w-0 flex-1 truncate font-mono text-mono-sm text-ink-3',
                )}
                title={job.error}
              >
                {job.error}
              </span>
            ) : null}
          </StateLine>
        ))}
      </Card>
    </div>
  )
}
