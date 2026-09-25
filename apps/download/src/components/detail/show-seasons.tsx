'use client'

import { cns } from '@lilnas/utils/cns'
import type {
  BadFile,
  DownloadJob,
  MediaState,
  Season,
  Show,
} from '@lilnas/utils/download/types'
import { DownloadType, isMediaInFlight } from '@lilnas/utils/download/types'
import type { JSX } from 'react'
import { useState } from 'react'

import { AttemptList } from 'src/components/detail/attempt-list'
import type {
  FlagBadFileAction,
  UnflagBadFileAction,
} from 'src/components/detail/bad-file-flag'
import type { DeleteMediaFilesAction } from 'src/components/detail/delete-confirm'
import { DeleteConfirm } from 'src/components/detail/delete-confirm'
import type { ImportDialogActions } from 'src/components/detail/import-dialog'
import type { JobAction } from 'src/components/detail/job-actions'
import {
  mediaStateIsLive,
  mediaStateLabel,
} from 'src/components/detail/media-state'
import { MediaStatus } from 'src/components/detail/media-status'
import type {
  ReleaseAction,
  ReleaseSearchAction,
} from 'src/components/detail/release-picker'
import { ShowEpisodeRow } from 'src/components/detail/show-episode-row'
import type { ShowRequestAction } from 'src/components/detail/show-request-button'
import { ShowRequestButton } from 'src/components/detail/show-request-button'
import {
  defaultSeasonNumber,
  deleteCascade,
  episodeProgressLabel,
  episodeScopedJobs,
  isDownloadableState,
  seasonByTabValue,
  seasonHeading,
  seasonLabel,
  seasonProgress,
  seasonScopedJobs,
  seasonState,
  seasonTabValue,
} from 'src/components/detail/show-state'
import { Card } from 'src/components/ui/card'
import { Dot } from 'src/components/ui/status'
import { Tab, Tabs } from 'src/components/ui/tabs'

/** What the panel says when Sonarr has never heard of this series. */
export const SEASONS_EMPTY_NOTE =
  'Not in the library yet, so there are no seasons to list. Downloading the series adds it to Sonarr and the episode list appears here.'

/** The accessible name of the season strip. */
export const SEASONS_TABLIST_LABEL = 'Season'

/**
 * What sits between a season's name and its live percentage — `Season 24 ·
 * 100%`.
 *
 * ⚠️ It is a real character rather than the `gap-1.5` that used to be the only
 * thing between them, and that distinction is the defect: the gap is a *visual*
 * separator, and the `Dot` beside it is `aria-hidden`, so the tab's accessible
 * name concatenated to `Season 24100%`. `·` is the separator the rest of this
 * app already uses for exactly this — `seasonHeading`'s `Season 2 · 10
 * episodes`, the release rows' `1080p WEB-DL · 2.1 GB`, `activity-rows`'
 * `paused · 62%`.
 */
const TAB_SEPARATOR = '·'

/**
 * The season states a tab marks with an amber dot: in flight but *stopped* -
 * somebody has to decide, or somebody paused it. `show-detail.pug`'s
 * `dot: 'warn'`.
 */
const WARN_TAB_STATES: ReadonlySet<MediaState> = new Set<MediaState>([
  'needs_attention',
  'paused',
])

/**
 * Stacked and full-width on a phone, inline from `sm` - the same
 * reconciliation the attempt cards' action row makes, and the same one
 * `show-detail.pug` writes as two separate frames.
 */
const SCOPE_ACTION = 'w-full sm:w-auto'

/**
 * ⚠️ `DeleteConfirm`'s `full` stretches **both** its `<div>` root and the
 * trigger inside it, unconditionally - there is no `sm:` half of that prop. So
 * the desktop width has to reach the trigger through the wrapper from here.
 *
 * A call-site fix with a comment, following the precedent an earlier task set
 * on `ui/gallery-card.tsx`: this is a layout fact about *this* container, not a
 * missing prop on a shipped, shared component two sibling tasks are rendering
 * concurrently.
 */
const SCOPE_DELETE = cns('w-full sm:w-auto', 'sm:[&>button]:w-auto')

export type ShowSeasonsProps = {
  /** This title's flags, passed through to each episode's picker. */
  badFiles?: readonly BadFile[]
  /**
   * The three importer server actions, passed straight through to the season's
   * own `AttemptList` and to every episode row under it. Whichever surface is
   * stuck forwards its own scope — a season attempt's is the season number, an
   * episode row's is the episode id and the season number — so nothing is
   * assembled here.
   */
  imports?: ImportDialogActions
  /** Every job for the title, newest first. Scoped per season/episode here. */
  jobs: readonly DownloadJob[]
  media: Show
  /** The instant every relative stamp is measured against, pinned by the page. */
  now: number
  /** `listSeasons` verbatim, including **season 0** - specials are listed. */
  seasons: readonly Season[]
  /** Reaches the season's attempt cards and each episode row's Cancel. */
  onCancel?: JobAction
  onDelete?: DeleteMediaFilesAction
  onFlag?: FlagBadFileAction
  onGrab?: ReleaseAction
  onReplace?: ReleaseAction
  onRequest?: ShowRequestAction
  /** ⚠️ Reaches a `ReleasePicker` trigger only. Never called on mount. */
  onSearch?: ReleaseSearchAction
  onUnflag?: UnflagBadFileAction
  /** Retries a season's newest failed attempt, while the season is downloadable. */
  onRetry?: JobAction
}

/**
 * The season strip and the episode list under it - `show-detail.pug`'s
 * `seasonTabs` + `episodeList`.
 *
 * ## ⚠️ `activationMode` - the decision, and why
 *
 * **Automatic**, which is `Tabs`' default and APG's default, and it is stated
 * explicitly below rather than left implicit because it is a deliberate
 * departure from what the other two tab strips in this app chose.
 *
 * `gallery-controls.tsx` and `activity-tabs.tsx` both opted into `'manual'`,
 * correctly: their strips *write the URL*, so selection-follows-focus would
 * fire a `router.push` and a server round trip on every arrow key. This strip
 * does not. `GET /media/:id/seasons` returns **every season with every
 * episode** in one payload, which this component already holds; switching
 * seasons swaps already-loaded content in place, costs nothing, fetches
 * nothing and navigates nowhere. Under those conditions automatic activation
 * is the better behaviour - arrowing through the strip shows each season as
 * you reach it, and nobody has to learn that a focused tab is not a selected
 * one.
 *
 * That is also why the selection is local `useState` rather than a search
 * param. Putting it in the URL would make a season deep-linkable, at the cost
 * of re-running the page's server render - and with it `getMedia` *and*
 * `listSeasons` against Sonarr - on every single tab press. The data is
 * already here; paying Sonarr for it again to gain a fragment in the address
 * bar is the wrong trade on a page this expensive to render. Nothing is
 * synced, so no `set-state-in-effect` rule is anywhere near this.
 *
 * ## Season 0
 *
 * Listed, never filtered. It comes back as `Specials`, it is selectable, and
 * its episodes are individually downloadable and deletable like any other. It
 * *is* excluded from the series-level totals, because Sonarr excludes it from
 * its own - see `seriesProgress`.
 *
 * ## The season's status and attempts
 *
 * Under the heading, the season's own `MediaStatus` - its episodes rolled up
 * by `seasonState`, so one episode needing a decision reads on the whole
 * season - and its `AttemptList`: every attempt scoped to this season or one
 * of its episodes. A whole-series attempt is listed once, by the series, not
 * on every tab.
 */
export function ShowSeasons({
  badFiles,
  imports,
  jobs,
  media,
  now,
  onCancel,
  onDelete,
  onFlag,
  onGrab,
  onReplace,
  onRequest,
  onRetry,
  onSearch,
  onUnflag,
  seasons,
}: ShowSeasonsProps): JSX.Element {
  const initial = defaultSeasonNumber(seasons)
  const [value, setValue] = useState(
    initial === null ? '' : seasonTabValue(initial),
  )
  // One drawer at a time: two open `ReleasePicker`s is two indexer sweeps a
  // press away from each other, and the list is long enough that a second open
  // drawer is off screen anyway.
  const [openEpisodeId, setOpenEpisodeId] = useState<number | null>(null)

  if (seasons.length === 0) {
    return (
      <Card className={cns('px-[14px] py-4 sm:px-4 sm:py-[18px]')} sunk>
        <p className={cns('max-w-[62ch] text-sm text-ink-3')}>
          {SEASONS_EMPTY_NOTE}
        </p>
      </Card>
    )
  }

  // A season the URL never named cannot go stale, but a revalidate *can* hand
  // back a series whose seasons changed under an open tab. Falling back to the
  // default is a render-time read of props, not a state write - there is
  // nothing to sync and no effect involved.
  const season = seasonByTabValue(seasons, value) ?? seasons[0]

  if (!season) {
    throw new Error('ShowSeasons: a non-empty season list resolved to nothing')
  }

  const scopedJobs = seasonScopedJobs(jobs, season)
  const progress = seasonProgress(season)
  const state = seasonState(season)
  const inFlight = isMediaInFlight(state)
  const label = seasonLabel(season.seasonNumber)

  function toggleEpisode(episodeId: number): void {
    setOpenEpisodeId(current => (current === episodeId ? null : episodeId))
  }

  return (
    <div className={cns('flex flex-col')}>
      <Tabs
        // ⚠️ Deliberate, and the opposite of what the other two strips chose.
        // See this component's own doc comment for the whole argument.
        activationMode="automatic"
        aria-label={SEASONS_TABLIST_LABEL}
        className={cns('mb-4 sm:mb-5')}
        scroll
        value={value}
        onValueChange={setValue}
      >
        {seasons.map(entry => (
          <SeasonTab key={entry.seasonNumber} season={entry} />
        ))}
      </Tabs>

      <div
        className={cns(
          'mb-[14px] flex flex-col gap-2.5',
          'sm:flex-row sm:items-center sm:justify-between sm:gap-4',
        )}
      >
        <h2 className={cns('text-h2')}>{seasonHeading(season)}</h2>
        <div
          className={cns(
            'flex flex-col gap-2',
            'sm:flex-row sm:shrink-0 sm:items-center sm:gap-2',
          )}
        >
          <ShowRequestButton
            className={cns(SCOPE_ACTION)}
            full
            label={`Download ${label.toLowerCase()}`}
            mediaId={media.id}
            size="sm"
            target={{ kind: 'season', seasonNumber: season.seasonNumber }}
            onRequest={onRequest}
          />
          {season.episodeFileCount > 0 ? (
            <DeleteConfirm
              className={cns(SCOPE_DELETE)}
              freesBytes={season.sizeOnDisk}
              full
              mediaId={media.id}
              scope={{
                // ⚠️ Predicted here, where every season and every episode's
                // state is in hand, so the dialog can say "this removes the
                // series from Sonarr" *before* the press rather than after.
                cascadesTo: deleteCascade(seasons, {
                  seasonNumber: season.seasonNumber,
                }),
                kind: 'season',
                seasonNumber: season.seasonNumber,
              }}
              size="sm"
              title={media.title}
              onDelete={onDelete}
            />
          ) : null}
        </div>
      </div>

      <MediaStatus
        className={cns('mb-[14px]')}
        data-scope="season"
        explain={
          // The count beside a settled chip; while the season is in flight
          // it moves under the bar instead, and a stuck one keeps the reason.
          inFlight || progress.total === 0 ? undefined : (
            <span className={cns('font-mono text-mono-sm')}>
              {episodeProgressLabel(progress)}
            </span>
          )
        }
        media={seasonMedia(media, state)}
        // ⚠️ The season's own aggregate, not a queue snapshot. The show's
        // snapshot is the whole series' grab, and a season is only ever as
        // far along as its files - "6 of 10 episodes" is the honest measure,
        // and the figure `show-detail.pug`'s own legend row prints.
        progressDetail={inFlight ? episodeProgressLabel(progress) : undefined}
        progressPct={inFlight ? progress.pct : undefined}
        scopeState={state}
      />

      <AttemptList
        className={cns('mb-[14px]')}
        imports={imports}
        jobs={scopedJobs}
        label={`${label} attempts`}
        now={now}
        onCancel={onCancel}
        onRetry={onRetry}
        // From the season's episodes, never the attempt: a failed season
        // grab over files that landed anyway must not offer to grab again.
        retryable={isDownloadableState(state)}
      />

      <Card className={cns('px-[14px] py-1 sm:px-4')} sunk>
        {season.episodes.length === 0 ? (
          <p className={cns('py-[13px] text-sm text-ink-3')}>
            Sonarr has not listed any episodes for this season yet.
          </p>
        ) : (
          season.episodes.map(episode => (
            <ShowEpisodeRow
              badFiles={badFiles}
              // ⚠️ The row cannot work this out: it holds one episode, and the
              // answer needs every season and every episode's state.
              cascadesTo={deleteCascade(seasons, {
                episodeId: episode.id,
                seasonNumber: episode.seasonNumber,
              })}
              episode={episode}
              imports={imports}
              // ⚠️ Keyed on Sonarr's episode id, the same key every scoped
              // action uses - `episodeNumber` repeats across seasons.
              key={episode.id}
              jobs={episodeScopedJobs(jobs, episode)}
              media={media}
              open={openEpisodeId === episode.id}
              onCancel={onCancel}
              onDelete={onDelete}
              onFlag={onFlag}
              onGrab={onGrab}
              onReplace={onReplace}
              onRequest={onRequest}
              onSearch={onSearch}
              onToggle={toggleEpisode}
              onUnflag={onUnflag}
            />
          ))
        )}
      </Card>
    </div>
  )
}

/**
 * The show as one season sees it, for that season's `MediaStatus`: the
 * season's rolled-up `state`, and **without** the series' `queueSnapshot` -
 * that is the whole series' grab, and would draw its bar on every tab. The
 * series' `stateReason` is kept only while the season itself needs a
 * decision; beside any other chip it would be explaining some other season.
 */
function seasonMedia(media: Show, state: MediaState): Show {
  const view: Show = { ...media, state }

  delete view.queueSnapshot
  if (state !== 'needs_attention') {
    delete view.stateReason
  }

  return view
}

type SeasonTabProps = {
  season: Season
}

/**
 * One tab: the season's name, plus its rolled-up state when that is worth a
 * glance from another tab - `show-detail.pug`'s `seasonTabs`. A breathing dot
 * and the season's percentage while it is downloading or importing
 * (`Season 3 ● 58%`); an amber dot while it needs a decision or is paused
 * (`Season 4 ●`); nothing for a settled season.
 *
 * ⚠️ The label is the long form (`Season 3`, `Specials`) at both widths, where
 * the mockup abbreviates to `S3` on its phone frame. One responsive document
 * cannot carry two different accessible names for the same control without
 * breaking label-in-name, and `Tabs`' own `scroll` - which the mockup's mobile
 * strip already opts into - is the affordance that makes a seven-season strip
 * work at 390px.
 */
function SeasonTab({ season }: SeasonTabProps): JSX.Element {
  const state = seasonState(season)
  const progress = seasonProgress(season)

  return (
    <Tab value={seasonTabValue(season.seasonNumber)}>
      <span className={cns('inline-flex items-center gap-1.5')}>
        {seasonLabel(season.seasonNumber)}
        {mediaStateIsLive(state) ? (
          <>
            {/*
              Real text, before the dot rather than after it: the dot marks the
              percentage as live, and the separator is what divides that unit
              from the season's name. Putting it here also means the tab's
              accessible name reads `Season 24 · 100%` instead of
              `Season 24100%`, which is the form the defect was found in.
            */}
            <span className={cns('text-ink-4')}>{TAB_SEPARATOR}</span>
            <Dot tone="live" />
            <span
              className={cns('font-mono text-mono-sm tabular-nums text-uv-hi')}
            >
              {`${Math.round(progress.pct)}%`}
            </span>
          </>
        ) : null}
        {WARN_TAB_STATES.has(state) ? (
          <>
            <Dot tone="warn" />
            {/*
              The dot is `aria-hidden`, so the state it marks is spelled out
              for assistive technology: `Season 4 · needs your decision`.
            */}
            <span className={cns('sr-only')}>
              {`${TAB_SEPARATOR} ${mediaStateLabel(state, DownloadType.Show)}`}
            </span>
          </>
        ) : null}
      </span>
    </Tab>
  )
}
