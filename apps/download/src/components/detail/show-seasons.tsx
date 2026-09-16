'use client'

import { cns } from '@lilnas/utils/cns'
import type {
  BadFile,
  DownloadJob,
  Season,
  Show,
} from '@lilnas/utils/download/types'
import type { JSX } from 'react'
import { useState } from 'react'

import type {
  FlagBadFileAction,
  UnflagBadFileAction,
} from 'src/components/detail/bad-file-flag'
import type { DeleteMediaFilesAction } from 'src/components/detail/delete-confirm'
import { DeleteConfirm } from 'src/components/detail/delete-confirm'
import { JobLifecycle } from 'src/components/detail/job-lifecycle'
import type {
  ReleaseAction,
  ReleaseSearchAction,
} from 'src/components/detail/release-picker'
import { ShowEpisodeRow } from 'src/components/detail/show-episode-row'
import type { ShowRequestAction } from 'src/components/detail/show-request-button'
import { ShowRequestButton } from 'src/components/detail/show-request-button'
import {
  defaultSeasonNumber,
  episodeProgressLabel,
  episodeScopedJobs,
  isScopeDownloading,
  seasonByTabValue,
  seasonHeading,
  seasonLabel,
  seasonProgress,
  seasonScopedJobs,
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
 * Stacked and full-width on a phone, inline from `sm` - the same
 * reconciliation `JobLifecycle`'s own action row makes, and the same one
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
  /** Every job for the title, newest first. Scoped per season/episode here. */
  jobs: readonly DownloadJob[]
  media: Show
  /** `listSeasons` verbatim, including **season 0** - specials are listed. */
  seasons: readonly Season[]
  onDelete?: DeleteMediaFilesAction
  onFlag?: FlagBadFileAction
  onGrab?: ReleaseAction
  onReplace?: ReleaseAction
  onRequest?: ShowRequestAction
  /** ⚠️ Reaches a `ReleasePicker` trigger only. Never called on mount. */
  onSearch?: ReleaseSearchAction
  onUnflag?: UnflagBadFileAction
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
 */
export function ShowSeasons({
  badFiles,
  jobs,
  media,
  onDelete,
  onFlag,
  onGrab,
  onReplace,
  onRequest,
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
  const downloading = isScopeDownloading(scopedJobs)

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
          <SeasonTab jobs={jobs} key={entry.seasonNumber} season={entry} />
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
            label={`Download ${seasonLabel(season.seasonNumber).toLowerCase()}`}
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
              scope={{ kind: 'season', seasonNumber: season.seasonNumber }}
              size="sm"
              title={media.title}
              onDelete={onDelete}
            />
          ) : null}
        </div>
      </div>

      {scopedJobs.length > 0 ? (
        <JobLifecycle
          actionSize="sm"
          className={cns('mb-[14px]')}
          jobs={scopedJobs}
          // ⚠️ The season's own aggregate, not the job's `queueSnapshot`. A
          // season job does not reach `completed` until the *last* episode
          // leaves Sonarr's queue, and the queue only ever describes the one
          // file moving right now - "6 of 10 episodes" is the honest measure of
          // how far a season download has got, and it is the figure
          // `show-detail.pug`'s own legend row prints.
          progressDetail={episodeProgressLabel(progress)}
          progressPct={downloading ? progress.pct : undefined}
        />
      ) : null}

      <Card className={cns('px-[14px] py-1 sm:px-4')} sunk>
        {season.episodes.length === 0 ? (
          <p className={cns('py-[13px] text-sm text-ink-3')}>
            Sonarr has not listed any episodes for this season yet.
          </p>
        ) : (
          season.episodes.map(episode => (
            <ShowEpisodeRow
              badFiles={badFiles}
              episode={episode}
              // ⚠️ Keyed on Sonarr's episode id, the same key every scoped
              // action uses - `episodeNumber` repeats across seasons.
              key={episode.id}
              jobs={episodeScopedJobs(jobs, episode)}
              media={media}
              open={openEpisodeId === episode.id}
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

type SeasonTabProps = {
  jobs: readonly DownloadJob[]
  season: Season
}

/**
 * One tab: the season's name, plus a breathing dot and its percentage while
 * something scoped to it is in flight - `show-detail.pug`'s `Season 3 ● 58%`.
 *
 * ⚠️ The label is the long form (`Season 3`, `Specials`) at both widths, where
 * the mockup abbreviates to `S3` on its phone frame. One responsive document
 * cannot carry two different accessible names for the same control without
 * breaking label-in-name, and `Tabs`' own `scroll` - which the mockup's mobile
 * strip already opts into - is the affordance that makes a seven-season strip
 * work at 390px.
 */
function SeasonTab({ jobs, season }: SeasonTabProps): JSX.Element {
  const scoped = seasonScopedJobs(jobs, season)
  const live = isScopeDownloading(scoped)
  const progress = seasonProgress(season)

  return (
    <Tab value={seasonTabValue(season.seasonNumber)}>
      <span className={cns('inline-flex items-center gap-1.5')}>
        {seasonLabel(season.seasonNumber)}
        {live ? (
          <>
            <Dot tone="live" />
            <span
              className={cns('font-mono text-mono-sm tabular-nums text-ok')}
            >
              {`${Math.round(progress.pct)}%`}
            </span>
          </>
        ) : null}
      </span>
    </Tab>
  )
}
