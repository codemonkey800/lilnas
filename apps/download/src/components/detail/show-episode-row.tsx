'use client'

import { cns } from '@lilnas/utils/cns'
import type {
  BadFile,
  DownloadJob,
  Episode,
  Show,
} from '@lilnas/utils/download/types'
import { isTerminalDownloadJobStatus } from '@lilnas/utils/download/types'
import type { JSX } from 'react'
import { useTransition } from 'react'

import type {
  FlagBadFileAction,
  UnflagBadFileAction,
} from 'src/components/detail/bad-file-flag'
import {
  REPORT_PROMPT_EPISODE,
  REPORT_REASONS_EPISODE,
} from 'src/components/detail/bad-file-flag'
import type { DeleteMediaFilesAction } from 'src/components/detail/delete-confirm'
import { DeleteConfirm } from 'src/components/detail/delete-confirm'
import type { ImportDialogActions } from 'src/components/detail/import-dialog'
import { ImportDialog } from 'src/components/detail/import-dialog'
import type { JobAction } from 'src/components/detail/job-actions'
import { ACTION_SPECS } from 'src/components/detail/job-actions'
import { jobActionState } from 'src/components/detail/job-state'
import type {
  ReleaseAction,
  ReleaseSearchAction,
} from 'src/components/detail/release-picker'
import { ReleasePicker } from 'src/components/detail/release-picker'
import { SaveLocal } from 'src/components/detail/save-local'
import type { ShowRequestAction } from 'src/components/detail/show-request-button'
import { ShowRequestButton } from 'src/components/detail/show-request-button'
import type { DeleteCascade } from 'src/components/detail/show-state'
import {
  episodeCode,
  episodeMediaState,
  episodeScopedJobs,
  episodeState,
  isDownloadableState,
} from 'src/components/detail/show-state'
import { Button } from 'src/components/ui/button'
import { Chip } from 'src/components/ui/chip'
import { StateLineActions } from 'src/components/ui/state-line'
import { Bar, Dot } from 'src/components/ui/status'
import { formatRuntime, UNKNOWN_VALUE } from 'src/lib/format'

/** The disclosure's two labels, and the eyebrow over what it reveals. */
export const EPISODE_ACTIONS_LABEL = 'Manage'
export const EPISODE_ACTIONS_HIDE_LABEL = 'Close'

/**
 * `show-detail.pug`'s `episode` mixin, reconciled into one responsive row:
 * stacked below `sm` (number and title, then the metadata run, then any
 * progress line) and one line from `sm` up.
 *
 * The `[&+&]:` divider lives on the *block*, not on the row - an expanded
 * drawer sits between two rows and would otherwise break the adjacency the
 * selector depends on.
 */
const EPISODE_BLOCK = '[&+&]:border-t [&+&]:border-line-soft'

const EPISODE_ROW = cns(
  'flex flex-col items-start gap-2 px-1 py-3',
  'sm:flex-row sm:items-center sm:gap-[14px]',
)

const EPISODE_NUMBER = 'w-[26px] shrink-0 font-mono text-mono-sm text-ink-4'

/** `ACTION_SPECS`' own Cancel, so the row's button reads like every other. */
const CANCEL_SPEC = ACTION_SPECS.find(spec => spec.key === 'cancel')

/**
 * How far this episode's own queue item has got, or `null` for no bar. Read
 * off the episode's `queueSnapshot` - which the server derives from Sonarr's
 * **full** queue - so a grab this app never started still draws one. A
 * missing or non-finite percentage draws nothing: a `0%` bar is a claim.
 */
function episodeQueuePct(episode: Episode): number | null {
  const pct = episode.queueSnapshot?.progress

  return pct !== undefined && Number.isFinite(pct) ? pct : null
}
const EPISODE_RUNTIME = 'font-mono text-mono-sm text-ink-4'

/**
 * A row action: splits the stacked row on a phone, natural width from `sm`.
 *
 * ⚠️ Deliberately **not** `ShowRequestButton`'s `full`, and this was measured
 * rather than guessed. `full` puts `w-full` on the component's `<div>` root as
 * well as on the trigger; inside an action group that is itself `sm:w-auto`,
 * that `w-full` resolves against a shrink-to-fit container and blows the group
 * past the card's right edge, pushing the disclosure outside it entirely.
 * Reaching the trigger through the wrapper is the call-site fix - the same one
 * the season and series headers make for `DeleteConfirm`, which has the
 * identical unconditional `full`.
 */
const ROW_ACTION = cns(
  'flex-1 [&>button]:w-full',
  'sm:flex-none sm:[&>button]:w-auto',
)

export type ShowEpisodeRowProps = {
  /** This title's flags, passed through to the picker. Joined on `releaseGuid`. */
  badFiles?: readonly BadFile[]
  /**
   * What deleting this episode takes beyond it - `'season'` unmonitors the
   * season, `'series'` removes the series from Sonarr.
   *
   * ⚠️ A **prop**, not something this row derives. `deleteCascade` needs every
   * season and every episode's state to answer; a row holds one episode. The
   * season panel has them all, so it computes it once per row rather than
   * each row reaching for data it was never given.
   */
  cascadesTo?: DeleteCascade
  episode: Episode
  /**
   * The three importer server actions. Omitted renders no Import control, the
   * same way a missing `onCancel` renders no Cancel — a page that never wired
   * the importer offers no way to resolve a stuck import from this row.
   */
  imports?: ImportDialogActions
  /**
   * Every job for this title. Filtered to this episode here rather than by the
   * caller, so the `scope.episodeId` match has exactly one spelling. Only an
   * in-flight one matters to the row — it withdraws Download and carries
   * Cancel; the attempts themselves are listed by the season and the series.
   */
  jobs: readonly DownloadJob[]
  media: Show
  /** Whether the actions drawer is open. Owned by the season panel. */
  open: boolean
  /**
   * Cancels this episode's in-flight attempt. Omitted renders no Cancel; the
   * page wires the show's own cancel route (see {@link ShowEpisodeRow}).
   */
  onCancel?: JobAction
  onDelete?: DeleteMediaFilesAction
  onFlag?: FlagBadFileAction
  onGrab?: ReleaseAction
  onReplace?: ReleaseAction
  onRequest?: ShowRequestAction
  /** ⚠️ Reaches the picker's trigger only. Never called on mount. */
  onSearch?: ReleaseSearchAction
  /** Opens or closes this row's drawer. */
  onToggle: (episodeId: number) => void
  onUnflag?: UnflagBadFileAction
}

/**
 * One episode, and everything that can be done to it.
 *
 * ⚠️ Every scoped action on this row is expressed through `Episode.id` -
 * Sonarr's primary key - and never by touching the media id, which stays
 * `tvdb:121361`. `episodeNumber` appears exactly once, in the `E5` label.
 *
 * ## Why the heavy controls are behind a disclosure
 *
 * A season can hold twenty-five episodes. `ReleasePicker` is a whole card with
 * a search prompt in it, `DeleteConfirm` is a dialog trigger, `SaveLocal` is a
 * third control - rendering all of that twenty-five times over turns the
 * episode list into a wall and buries the one thing the mockup's row is for,
 * which is making each episode's state legible at a glance. So the row stays
 * the mockup's row, and the drawer holds the rest.
 *
 * ⚠️ It is also the safer arrangement. The release search is a 30s+ indexer
 * sweep that **writes upstream** (it borrows monitoring to ask), so a page that
 * mounted twenty-five pickers would be twenty-five triggers deep in a surface
 * nobody has asked anything of yet. `ReleasePicker` already guarantees it never
 * searches without a press; the drawer means the press is two deliberate steps
 * away rather than one stray click.
 *
 * ## State from the episode, controls from the attempt
 *
 * The chip and the bar read the episode's own `state` and `queueSnapshot`, so
 * an episode Sonarr grabbed on its own reads `downloading` with a bar and no
 * job anywhere. Each control is gated on what it acts on:
 *
 * - **Download** - the episode is `absent`/`wanted` and no attempt at it is in
 *   flight (a search that has not queued anything yet still reads `wanted`).
 * - **Import** - the episode is `needs_attention`. The importer is addressed
 *   by media key and scope, never by job, so it needs no attempt behind it.
 * - **Cancel** - this episode's own in-flight attempt, and only when the page
 *   wired `onCancel` — which it does, to the show's own
 *   `PATCH /download/shows/:id/cancel`. There is no per-row Pause or Resume:
 *   those are `/download/videos/:id` routes with no show equivalent.
 *
 * ## One control the mockup draws that is not here
 *
 * **Watch, per episode.** Emby's handoff is at the *series* level - its
 * `Path` is the series folder and `embyStatus.watchUrl` addresses the series
 * item. There is no per-episode Emby URL on the wire, so the Watch action
 * lives once, in the header.
 */
export function ShowEpisodeRow({
  badFiles,
  cascadesTo,
  episode,
  imports,
  jobs,
  media,
  onCancel,
  onDelete,
  onFlag,
  onGrab,
  onReplace,
  onRequest,
  onSearch,
  onToggle,
  onUnflag,
  open,
}: ShowEpisodeRowProps): JSX.Element {
  const [cancelling, startCancel] = useTransition()

  const mediaState = episodeMediaState(episode)
  const state = episodeState(episode)
  // The newest attempt at this episode that is still open work, if any.
  const attempt =
    episodeScopedJobs(jobs, episode).find(
      job => !isTerminalDownloadJobStatus(job.status),
    ) ?? null
  const cancel = attempt ? jobActionState(attempt.status, 'cancel') : 'none'
  const pct = episodeQueuePct(episode)
  const runtime = formatRuntime(episode.runtime, 'hours')
  const code = episodeCode(episode.seasonNumber, episode.episodeNumber)

  function runCancel(action: JobAction, jobId: string): void {
    startCancel(async () => {
      await action(jobId)
    })
  }

  return (
    <div className={cns(EPISODE_BLOCK)} data-episode-id={episode.id}>
      <div className={cns(EPISODE_ROW)}>
        <span className={cns('flex items-center gap-2 sm:min-w-0 sm:flex-1')}>
          <span className={cns(EPISODE_NUMBER)}>
            {`E${episode.episodeNumber}`}
          </span>
          <span className={cns('text-sm sm:truncate')}>
            {episode.title ?? UNKNOWN_VALUE}
          </span>
        </span>
        <span
          className={cns('flex flex-wrap items-center gap-2.5 sm:shrink-0')}
        >
          <span className={cns(EPISODE_RUNTIME)}>{runtime}</span>
          <Chip tone={state.tone}>
            {state.live ? <Dot tone="live" /> : null}
            {state.label}
          </Chip>
        </span>
        {pct === null ? null : (
          <span
            className={cns(
              'flex w-full items-center gap-2 sm:w-[120px] sm:shrink-0',
            )}
          >
            <Bar
              aria-label={`${code} download progress`}
              className={cns('flex-1')}
              pct={pct}
            />
            <span
              aria-hidden="true"
              className={cns('font-mono text-mono-sm tabular-nums text-uv-hi')}
            >
              {`${Math.round(pct)}%`}
            </span>
          </span>
        )}
        <span className={cns('flex w-full gap-2 sm:w-auto sm:shrink-0')}>
          {mediaState === 'needs_attention' && imports ? (
            <ImportDialog
              actions={imports}
              className={cns(ROW_ACTION)}
              mediaId={media.id}
              // ⚠️ `Episode.id` is what narrows the request to this episode;
              // `seasonNumber` rides along because the importer's queries take
              // the whole `ShowScope`. The media key stays `tvdb:277165`.
              scope={{
                episodeId: episode.id,
                seasonNumber: episode.seasonNumber,
              }}
              size="sm"
              // ⚠️ `job.media.title` is the *series* title, which on a row that
              // already names one episode would read as though the whole show
              // were stuck. The code is what distinguishes this row from the
              // other twenty-four, so the heading is `Silicon Valley S01E01`.
              title={`${media.title} ${code}`}
            />
          ) : null}
          {attempt && onCancel && CANCEL_SPEC && cancel !== 'none' ? (
            <Button
              // `acknowledged` is a press the backend already took
              // (`cancelling`): the control stays, inert, rather than vanishing.
              aria-disabled={
                cancel === 'acknowledged' || cancelling || undefined
              }
              className={cns('flex-1 sm:flex-none')}
              iconEnd={CANCEL_SPEC.iconEnd}
              size="sm"
              variant={CANCEL_SPEC.variant}
              onClick={() => runCancel(onCancel, attempt.id)}
            >
              {CANCEL_SPEC.label}
            </Button>
          ) : null}
          {isDownloadableState(mediaState) && !attempt ? (
            <ShowRequestButton
              className={cns(ROW_ACTION)}
              mediaId={media.id}
              size="sm"
              target={{ episodeId: episode.id, kind: 'episode' }}
              onRequest={onRequest}
            />
          ) : null}
          <Button
            aria-expanded={open}
            className={cns('flex-1 sm:flex-none')}
            iconEnd="chevron"
            size="sm"
            variant="ghost"
            onClick={() => onToggle(episode.id)}
          >
            {open ? EPISODE_ACTIONS_HIDE_LABEL : EPISODE_ACTIONS_LABEL}
          </Button>
        </span>
      </div>
      {open ? (
        <div className={cns('flex flex-col gap-3 px-1 pt-1 pb-[13px]')}>
          <ReleasePicker
            badFiles={badFiles}
            // ⚠️ Absent whenever the file on disk cannot be traced back to a
            // release - a manual import, a pruned history, a degraded
            // resolver. `undefined` is the honest answer there, and it renders
            // exactly as this row did before the guid existed: no `current`
            // chip, and so no report control.
            currentGuid={episode.currentReleaseGuid}
            episodeId={episode.id}
            hasFile={episode.hasFile}
            label={null}
            mediaId={media.id}
            reportPrompt={REPORT_PROMPT_EPISODE}
            reportReasons={REPORT_REASONS_EPISODE}
            seasonNumber={episode.seasonNumber}
            onFlag={onFlag}
            onGrab={onGrab}
            onReplace={onReplace}
            onSearch={onSearch}
            onUnflag={onUnflag}
          />
          {episode.hasFile ? (
            <StateLineActions className={cns('max-w-[480px]')}>
              {/*
                ⚠️ `SaveLocal` renders an `<a>` and `DeleteConfirm` a `<div>`,
                and `StateLineActions`' `[&>button]:flex-1` reaches neither.
                A call-site fix, per the established precedent: both are
                shipped, shared components and this is a layout fact about
                *this* container, not a missing prop on either of them.
              */}
              <SaveLocal
                className={cns('flex-1')}
                episodeId={episode.id}
                media={media}
                size="sm"
              />
              <DeleteConfirm
                className={cns('flex-1')}
                full
                mediaId={media.id}
                scope={{
                  cascadesTo,
                  episodeId: episode.id,
                  episodeNumber: episode.episodeNumber,
                  kind: 'episode',
                  seasonNumber: episode.seasonNumber,
                }}
                size="sm"
                title={media.title}
                onDelete={onDelete}
              />
            </StateLineActions>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
