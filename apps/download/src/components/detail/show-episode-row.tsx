'use client'

import { cns } from '@lilnas/utils/cns'
import type {
  BadFile,
  DownloadJob,
  Episode,
  Show,
} from '@lilnas/utils/download/types'
import type { JSX } from 'react'

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
import { jobProgress, latestJob } from 'src/components/detail/job-state'
import type {
  ReleaseAction,
  ReleaseSearchAction,
} from 'src/components/detail/release-picker'
import { ReleasePicker } from 'src/components/detail/release-picker'
import { SaveLocal } from 'src/components/detail/save-local'
import type { ShowRequestAction } from 'src/components/detail/show-request-button'
import { ShowRequestButton } from 'src/components/detail/show-request-button'
import {
  episodeCode,
  episodeScopedJobs,
  episodeState,
} from 'src/components/detail/show-state'
import { Button } from 'src/components/ui/button'
import { Chip } from 'src/components/ui/chip'
import { StateLineActions } from 'src/components/ui/state-line'
import { Bar, Dot } from 'src/components/ui/status'
import { formatRuntime, isInProgress, UNKNOWN_VALUE } from 'src/lib/format'

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
  episode: Episode
  /**
   * Every job for this title. Filtered to this episode here rather than by the
   * caller, so the `scope.episodeId` match has exactly one spelling.
   */
  jobs: readonly DownloadJob[]
  media: Show
  /** Whether the actions drawer is open. Owned by the season panel. */
  open: boolean
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
 * ## Two controls the mockup draws that are not here
 *
 * - **Watch, per episode.** Emby's handoff is at the *series* level - its
 *   `Path` is the series folder and `embyStatus.watchUrl` addresses the series
 *   item. There is no per-episode Emby URL on the wire, so the Watch action
 *   lives once, in the header.
 * - **Cancel, per episode.** `cancelJob`/`pauseJob`/`resumeJob` are all
 *   `/download/videos/:id` routes - **video only**. A show download has no
 *   cancel endpoint at any scope, so offering the button would be offering a
 *   404.
 */
export function ShowEpisodeRow({
  badFiles,
  episode,
  jobs,
  media,
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
  const scoped = episodeScopedJobs(jobs, episode)
  const state = episodeState(episode, scoped)
  const latest = latestJob(scoped)
  const runtime = formatRuntime(episode.runtime, 'hours')
  // ⚠️ Only while the job is open work. `jobProgress` reads the *series'*
  // `queueSnapshot`, so a finished episode job would otherwise keep drawing
  // whatever Sonarr's queue happens to hold for some other episode.
  const progress =
    latest && isInProgress(latest.status) ? jobProgress(latest) : null
  const code = episodeCode(episode.seasonNumber, episode.episodeNumber)

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
        {progress ? (
          <span
            className={cns(
              'flex w-full items-center gap-2 sm:w-[120px] sm:shrink-0',
            )}
          >
            <Bar
              aria-label={`${code} download progress`}
              className={cns('flex-1')}
              pct={progress.pct}
            />
            <span
              aria-hidden="true"
              className={cns('font-mono text-mono-sm tabular-nums text-uv-hi')}
            >
              {`${Math.round(progress.pct)}%`}
            </span>
          </span>
        ) : null}
        <span className={cns('flex w-full gap-2 sm:w-auto sm:shrink-0')}>
          {episode.hasFile || latest ? null : (
            <ShowRequestButton
              className={cns(ROW_ACTION)}
              mediaId={media.id}
              size="sm"
              target={{ episodeId: episode.id, kind: 'episode' }}
              onRequest={onRequest}
            />
          )}
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
