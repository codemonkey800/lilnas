import '@testing-library/jest-dom'

import type {
  BadFile,
  DownloadJob,
  Movie,
  Release,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  REPORT_LABEL,
  REPORTED_LABEL,
  UNDO_REPORT_LABEL,
} from 'src/components/detail/bad-file-flag'
import { deleteConfirmCopy } from 'src/components/detail/delete-confirm'
import { IMPORT_TRIGGER_LABEL } from 'src/components/detail/import-dialog'
import type { MovieDetailProps } from 'src/components/detail/movie-detail'
import {
  isMetadataUnavailable,
  MOVIE_EMBY_UNAVAILABLE_LABEL,
  MOVIE_EXTERNAL_QUEUE_NOTE,
  MOVIE_INDEXING_LABEL,
  MOVIE_METADATA_NOTE,
  MOVIE_STALE_LABEL,
  MOVIE_WATCH_LABEL,
  MovieDetail,
  movieHasFile,
  movieMetaLine,
  movieWatchState,
} from 'src/components/detail/movie-detail'
import { MOVIE_REQUEST_LABEL } from 'src/components/detail/movie-request-button'
import {
  RELEASE_CURRENT_LABEL,
  RELEASE_GRAB_LABEL,
  RELEASE_REPLACE_LABEL,
  RELEASE_SEARCH_LABEL,
} from 'src/components/detail/release-picker'
import { SAVE_LOCAL_LABEL } from 'src/components/detail/save-local'

const MOVIE_ID = 'tmdb:438631'

/** 2h 04m, in the seconds `MediaBase.runtime` is actually carried in. */
const RUNTIME_SECONDS = 7440

const WATCH_URL = 'https://emby.lilnas.io/web/index.html#!/item?id=41f2'

const MOVIE: Movie = {
  certification: 'PG-13',
  embyStatus: { itemId: '41f2', state: 'indexed', watchUrl: WATCH_URL },
  filePath: '/storage/media-library/movies/Salt & Ceremony (2024)/salt.mkv',
  genres: ['Drama', 'Thriller'],
  id: MOVIE_ID,
  overview:
    "A quiet coastal town's annual ceremony turns into a reckoning when the tide brings back what it took ten years ago.",
  posterUrl: '/MoviePoster.jpg',
  ratingValue: 7.44,
  releaseDate: '2024-03-08',
  runtime: RUNTIME_SECONDS,
  state: 'available',
  title: 'Salt & Ceremony',
  tmdbId: 438631,
  type: DownloadType.Movie,
  year: 2024,
}

/** Nothing on disk and nothing asked for — no `filePath`, so no `embyStatus`. */
const UNFETCHED: Movie = {
  ...MOVIE,
  embyStatus: undefined,
  filePath: undefined,
  state: 'absent',
}

/** Monitored in Radarr, nothing queued yet. */
const WANTED: Movie = { ...UNFETCHED, state: 'wanted' }

/**
 * A queue item Radarr is running for a movie with nothing on disk — a grab
 * from Radarr's own UI, which the poller adopts as an attempt within a tick.
 */
const RADARR_GRAB: Movie = {
  ...UNFETCHED,
  queueSnapshot: { progress: 47, status: 'downloading', timeLeft: '00:12:30' },
  state: 'downloading',
}

/**
 * Radarr replacing the file already on disk — `movie-detail.pug`'s "Radarr
 * upgrading the file on disk" frame. Never adopted, so no attempt covers it.
 */
const RADARR_UPGRADE: Movie = {
  ...MOVIE,
  queueSnapshot: { progress: 47, status: 'downloading', timeLeft: '00:12:30' },
  state: 'downloading',
}

/**
 * ⚠️ The payload shape the live page was actually handed, and the one this
 * whole fix is about: Emby has indexed the file and offers a working `Watch`
 * link, and `filePath` never arrived — Radarr's library cache does not expand
 * `movieFile`, and `MovieSchema` has no `hasFile` to fall back on.
 */
const INDEXED_NO_PATH: Movie = {
  ...MOVIE,
  filePath: undefined,
}

/** What `GET /media/:id` recovers from Radarr's history, when it can. */
const CURRENT_GUID = 'indexer://f00ba7'

/**
 * The same movie, with the release behind its file on disk identified.
 *
 * ⚠️ `undefined`, never `null` and never `''` — {@link MOVIE} is the absent
 * case, which is a manual import or history Radarr has since pruned.
 */
const ON_DISK: Movie = { ...MOVIE, currentReleaseGuid: CURRENT_GUID }

const JOB: DownloadJob = {
  completedAt: '2026-09-15T11:48:00.000Z',
  createdAt: '2026-09-15T11:20:00.000Z',
  discordRequester: null,
  hiddenAttribution: false,
  id: 'job-1',
  linkedDiscord: null,
  media: MOVIE,
  requester: { email: 'jeremy.asuncion@lilnas.io', userId: 'u_jeremy' },
  status: DownloadJobStatus.Completed,
  updatedAt: '2026-09-15T11:48:00.000Z',
}

/** The restart that failed *Cars*' newest job, long after the file landed. */
const FAILED: DownloadJob = {
  ...JOB,
  completedAt: '2026-09-15T11:50:00.000Z',
  createdAt: '2026-09-15T11:49:00.000Z',
  error: 'Stopped responding partway through.',
  id: 'job-failed',
  status: DownloadJobStatus.Failed,
}

/** A grab this app just asked Radarr for. */
const PENDING: DownloadJob = {
  ...JOB,
  completedAt: null,
  createdAt: '2026-09-15T11:55:00.000Z',
  id: 'job-pending',
  status: DownloadJobStatus.Pending,
}

const EARLIER = '2026-09-15T10:00:00.000Z'

const NOW = Date.parse('2026-09-15T12:00:00.000Z')

const ALTERNATIVE: Release = {
  downloadAllowed: true,
  flaggedBad: false,
  guid: 'guid-2160',
  indexer: 'nyaa-hd',
  indexerId: 4,
  quality: { name: '2160p WEB-DL', resolution: 2160 },
  rejected: false,
  size: 5.8 * 1024 ** 3,
  title: 'Salt.and.Ceremony.2024.2160p.WEB-DL',
}

/**
 * The row the backend prepends when today's indexer sweep no longer returns
 * the release that produced the file — a grab from months ago usually will
 * not come back, so `listReleases` synthesizes the row from its own cached
 * record instead.
 *
 * ⚠️ No `quality` and `indexerId: 0`, because the history that record is built
 * from carries no `QualityModel` and no indexer id. Its quality column is
 * therefore an em dash — the release title has its own column now and is no
 * longer the fallback for an unqualified row.
 */
const CURRENT: Release = {
  downloadAllowed: true,
  flaggedBad: false,
  guid: CURRENT_GUID,
  indexerId: 0,
  rejected: false,
  title: 'Salt.and.Ceremony.2024.1080p.WEB-DL',
}

const FLAG: BadFile = {
  createdAt: '2026-09-15T11:00:00.000Z',
  flaggedBy: { email: 'jeremy.asuncion@lilnas.io', userId: 'u_jeremy' },
  id: 9,
  indexerId: 4,
  mediaId: MOVIE_ID,
  reason: "Video won't play",
  releaseGuid: 'guid-2160',
  releaseTitle: ALTERNATIVE.title,
}

/** The same report, against the release actually on disk. */
const CURRENT_FLAG: BadFile = {
  ...FLAG,
  id: 10,
  indexerId: CURRENT.indexerId,
  releaseGuid: CURRENT_GUID,
  releaseTitle: CURRENT.title,
}

function renderDetail(overrides: Partial<MovieDetailProps> = {}) {
  return render(
    <MovieDetail jobs={[JOB]} media={MOVIE} now={NOW} {...overrides} />,
  )
}

/**
 * The visible copy of a control the page renders twice — once for the stacked
 * layout and once for the inline one, with `display: none` on whichever the
 * width does not want. jsdom applies no stylesheet, so both are in the tree
 * here and the desktop copy (the first) is the one exercised.
 */
function firstButton(name: RegExp | string): HTMLElement {
  const [first] = screen.getAllByRole('button', { name })

  if (!first) {
    throw new Error(`no button named ${String(name)}`)
  }

  return first
}

/** The Attempts section, or `null` when the page drew none. */
function attempts(): HTMLElement | null {
  return screen.queryByRole('region', { name: 'Attempts' })
}

/** `MediaStatus`'s root, which carries the state it drew as `data-state`. */
function mediaStatus(): Element | null {
  return document.querySelector('div[data-state]')
}

/** The header's one-press Download, which the page draws exactly once. */
function downloadButton(): HTMLElement {
  return screen.getByRole('button', { name: MOVIE_REQUEST_LABEL })
}

/**
 * One release row, found by the full release name it carries as its `title`.
 * The first match is the desktop copy, for the same reason {@link firstButton}
 * takes the first button.
 */
function releaseRow(release: Release): HTMLElement {
  const element = document.querySelector(`[title="${release.title}"]`)

  if (!(element instanceof HTMLElement)) {
    throw new Error(`no row for ${release.title}`)
  }

  return element
}

describe('movieWatchState', () => {
  it('offers a watch link once Emby has indexed the file', () => {
    expect(movieWatchState(MOVIE)).toBe('indexed')
  })

  it('reports indexing while Emby has the file but not the entry', () => {
    expect(
      movieWatchState({ ...MOVIE, embyStatus: { state: 'indexing' } }),
    ).toBe('indexing')
  })

  it("reports unknown when Emby's own lookup failed", () => {
    expect(
      movieWatchState({ ...MOVIE, embyStatus: { state: 'unknown' } }),
    ).toBe('unknown')
  })

  it('reports none when there is no file on disk at all', () => {
    // `embyStatus` is absent entirely for a title with no file — Emby is
    // never consulted in that case, so there is nothing to say.
    expect(movieWatchState(UNFETCHED)).toBe('none')
  })

  it('degrades an indexed state with no watchUrl rather than linking nowhere', () => {
    expect(
      movieWatchState({ ...MOVIE, embyStatus: { state: 'indexed' } }),
    ).toBe('unknown')
  })
})

describe('movieHasFile', () => {
  it('reads filePath — Radarr populates it only once the file exists', () => {
    expect(movieHasFile({ ...MOVIE, embyStatus: undefined })).toBe(true)
  })

  it('⚠️ reads embyStatus too, which is the live payload shape', () => {
    // The resolver consults Emby only for a title that has a file, so the mere
    // presence of a status is a second, independent witness — and it is the
    // only one the live page was given.
    expect(movieHasFile(INDEXED_NO_PATH)).toBe(true)
  })

  it.each([['indexing'] as const, ['unknown'] as const])(
    'does not read %p as "no file" — neither state means the file is gone',
    state => {
      expect(
        movieHasFile({ ...MOVIE, embyStatus: { state }, filePath: undefined }),
      ).toBe(true)
    },
  )

  it('answers false only when neither witness is there', () => {
    expect(movieHasFile(UNFETCHED)).toBe(false)
  })
})

describe('movieMetaLine', () => {
  it('renders year, runtime, certification, rating and genres in one line', () => {
    expect(movieMetaLine(MOVIE)).toBe(
      '2024 · 2h 04m · PG-13 · 7.4/10 · Drama, Thriller',
    )
  })

  it('reads runtime as seconds, not minutes', () => {
    // 7440 is 124 minutes. Read as minutes it would be 124 hours.
    expect(movieMetaLine({ ...MOVIE, runtime: RUNTIME_SECONDS })).toContain(
      '2h 04m',
    )
  })

  it('drops a sub-hour runtime down to minutes alone', () => {
    expect(movieMetaLine({ ...MOVIE, runtime: 42 * 60 })).toContain('42m')
  })

  it('omits the runtime upstream reports as zero rather than claiming 0m', () => {
    const line = movieMetaLine({ ...MOVIE, runtime: 0 })

    expect(line).not.toContain('0m')
    expect(line).toBe('2024 · PG-13 · 7.4/10 · Drama, Thriller')
  })

  it('omits an unknown runtime rather than rendering an em dash', () => {
    expect(movieMetaLine({ ...MOVIE, runtime: undefined })).toBe(
      '2024 · PG-13 · 7.4/10 · Drama, Thriller',
    )
  })

  it('rounds a rating to one decimal', () => {
    expect(movieMetaLine({ ...MOVIE, ratingValue: 7.437 })).toContain('7.4/10')
  })

  it('omits a rating of zero, which upstream means as "unrated"', () => {
    expect(movieMetaLine({ ...MOVIE, ratingValue: 0 })).not.toContain('/10')
  })

  it('omits an empty genre list rather than leaving a dangling separator', () => {
    expect(movieMetaLine({ ...MOVIE, genres: [] })).toBe(
      '2024 · 2h 04m · PG-13 · 7.4/10',
    )
  })

  it('omits a missing year', () => {
    expect(movieMetaLine({ ...MOVIE, year: undefined })).toBe(
      '2h 04m · PG-13 · 7.4/10 · Drama, Thriller',
    )
  })

  it('answers null when a movie carries no metadata at all', () => {
    expect(
      movieMetaLine({
        id: MOVIE_ID,
        title: MOVIE_ID,
        tmdbId: 438631,
        type: DownloadType.Movie,
      }),
    ).toBeNull()
  })
})

describe('isMetadataUnavailable', () => {
  it('recognises the resolver placeholder by its title being its own key', () => {
    expect(
      isMetadataUnavailable({
        id: MOVIE_ID,
        title: MOVIE_ID,
        tmdbId: 438631,
        type: DownloadType.Movie,
      }),
    ).toBe(true)
  })

  it('treats a resolved movie as available', () => {
    expect(isMetadataUnavailable(MOVIE)).toBe(false)
  })
})

describe('MovieDetail — the Emby handoff', () => {
  it('links Watch straight at the URL the payload carries', () => {
    renderDetail()

    const watch = screen.getByRole('link', { name: MOVIE_WATCH_LABEL })

    // ⚠️ Never constructed here. `watchUrl` is built server-side from
    // EMBY_EXTERNAL_URL, which is the host a browser can reach; EMBY_URL is
    // the in-network one and is not.
    expect(watch).toHaveAttribute('href', WATCH_URL)
    expect(watch.tagName).toBe('A')
  })

  it('opens Emby in a new tab without leaking the referrer', () => {
    renderDetail()

    const watch = screen.getByRole('link', { name: MOVIE_WATCH_LABEL })

    expect(watch).toHaveAttribute('target', '_blank')
    expect(watch).toHaveAttribute('rel', 'noreferrer')
  })

  it('offers no Watch while Emby is still indexing, and says so', () => {
    renderDetail({ media: { ...MOVIE, embyStatus: { state: 'indexing' } } })

    expect(
      screen.queryByRole('link', { name: MOVIE_WATCH_LABEL }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(MOVIE_INDEXING_LABEL)).toBeInTheDocument()
  })

  it('says Emby could not be asked when its lookup failed', () => {
    renderDetail({ media: { ...MOVIE, embyStatus: { state: 'unknown' } } })

    expect(
      screen.queryByRole('link', { name: MOVIE_WATCH_LABEL }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(MOVIE_EMBY_UNAVAILABLE_LABEL)).toBeInTheDocument()
  })

  it('draws neither a Watch nor an indexing state when there is no file', () => {
    renderDetail({ jobs: [], media: UNFETCHED })

    expect(
      screen.queryByRole('link', { name: MOVIE_WATCH_LABEL }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(MOVIE_INDEXING_LABEL)).not.toBeInTheDocument()
    expect(
      screen.queryByText(MOVIE_EMBY_UNAVAILABLE_LABEL),
    ).not.toBeInTheDocument()
  })

  it('never renders an in-app player', () => {
    const { container } = renderDetail()

    expect(container.querySelector('video')).toBeNull()
  })
})

describe('MovieDetail — metadata', () => {
  it('renders the title as the document heading', () => {
    renderDetail()

    expect(
      screen.getByRole('heading', { level: 1, name: MOVIE.title }),
    ).toBeInTheDocument()
  })

  it('renders the runtime as hours and minutes', () => {
    renderDetail()

    expect(
      screen.getByText('2024 · 2h 04m · PG-13 · 7.4/10 · Drama, Thriller'),
    ).toBeInTheDocument()
  })

  it('renders the overview', () => {
    renderDetail()

    expect(screen.getByText(MOVIE.overview ?? '')).toBeInTheDocument()
  })

  it('draws no cast row, because nothing on the wire carries one', () => {
    const { container } = renderDetail()

    expect(container.textContent).not.toContain('more')
  })

  it('explains a Radarr outage instead of pretending the movie is missing', () => {
    renderDetail({
      jobs: [],
      media: {
        id: MOVIE_ID,
        title: MOVIE_ID,
        tmdbId: 438631,
        type: DownloadType.Movie,
      },
    })

    expect(screen.getByText(MOVIE_METADATA_NOTE)).toBeInTheDocument()
  })

  it('says nothing about metadata when Radarr answered', () => {
    renderDetail()

    expect(screen.queryByText(MOVIE_METADATA_NOTE)).not.toBeInTheDocument()
  })
})

describe('MovieDetail — attribution', () => {
  it('names the requester and when it landed', () => {
    renderDetail()

    // The email's local part, not an invented display name: the wire carries
    // only `email`.
    expect(screen.getByText(/jeremy\.asuncion · 12m ago/)).toBeInTheDocument()
  })

  it('renders no hide toggle — a movie is always attributed', () => {
    renderDetail()

    expect(
      screen.queryByRole('button', { name: /hide/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('switch', { name: /attribut/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: /attribut/i }),
    ).not.toBeInTheDocument()
  })

  it('renders a server-masked requester as hidden rather than re-deriving the rule', () => {
    renderDetail({ jobs: [{ ...JOB, requester: null }] })

    expect(screen.getByText(/hidden · 12m ago/)).toBeInTheDocument()
  })

  it('draws no attribution at all for a movie this app never fetched', () => {
    renderDetail({ jobs: [] })

    // Deliberately narrow: the synopsis fixture ends "ten years ago".
    expect(screen.queryByText(/· \d+\w+ ago/)).not.toBeInTheDocument()
  })

  it('credits the newest attempt, whatever became of it', () => {
    renderDetail({
      jobs: [
        {
          ...FAILED,
          id: 'job-2',
          requester: { email: 'sam@lilnas.io', userId: 'u_sam' },
        },
        JOB,
      ],
    })

    expect(screen.getByText(/^sam · /)).toBeInTheDocument()
  })
})

describe('MovieDetail — media state', () => {
  it('chips a library movie with no attempts "in library", with no Download and no Attempts', () => {
    renderDetail({ jobs: [] })

    expect(screen.getByText('in library')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: MOVIE_REQUEST_LABEL }),
    ).not.toBeInTheDocument()
    expect(attempts()).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: MOVIE_WATCH_LABEL }),
    ).toBeInTheDocument()
  })

  it('⚠️ reads the live payload shape: filePath absent, embyStatus indexed', () => {
    // The shape `GET /media/:id` actually handed the page. The chip reads
    // `state`; Watch, Save and Delete still read the file witnesses.
    renderDetail({ jobs: [], media: INDEXED_NO_PATH })

    expect(screen.getByText('in library')).toBeInTheDocument()
    expect(firstButton(/^delete$/i)).toBeInTheDocument()
  })

  it('chips a movie with nothing grabbed "not downloaded" and offers Download', () => {
    renderDetail({ jobs: [], media: UNFETCHED })

    expect(screen.getByText('not downloaded')).toBeInTheDocument()
    expect(downloadButton()).toBeInTheDocument()
    expect(attempts()).not.toBeInTheDocument()
  })

  it('offers Download for a wanted movie', () => {
    renderDetail({ jobs: [], media: WANTED })

    expect(screen.getByText('wanted')).toBeInTheDocument()
    expect(downloadButton()).toBeInTheDocument()
  })

  it('draws the queue’s progress with no attempt behind it — the tick before adoption', () => {
    renderDetail({ jobs: [], media: RADARR_GRAB })

    // The chip, not the queue's own status note under the bar, which happens
    // to say the same word.
    expect(mediaStatus()).toHaveAttribute('data-state', 'downloading')
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '47',
    )
    expect(screen.getByText(MOVIE_EXTERNAL_QUEUE_NOTE)).toBeInTheDocument()
    expect(attempts()).not.toBeInTheDocument()
    // Radarr has it in hand — a second grab would race the queue item.
    expect(
      screen.queryByRole('button', { name: MOVIE_REQUEST_LABEL }),
    ).not.toBeInTheDocument()
  })

  it('draws no bar at all when there is no queue snapshot', () => {
    renderDetail({ jobs: [], media: WANTED })

    // A 0% bar is a claim. No snapshot means "draw nothing".
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('says a stuck import needs a decision, and why', () => {
    renderDetail({
      jobs: [],
      media: {
        ...UNFETCHED,
        state: 'needs_attention',
        stateReason: 'No files found are eligible for import',
      },
    })

    expect(screen.getByText('needs your decision')).toBeInTheDocument()
    expect(
      screen.getByText('No files found are eligible for import'),
    ).toBeInTheDocument()
  })

  it('⚠️ Cars: a failed newest attempt over a movie on disk still reads "in library"', () => {
    // The motivating bug. A restart failed the newest job for a movie that was
    // perfectly playable, and the page — reading the job — chipped it
    // `failed`. The chip reads the movie; the failure is an attempt.
    renderDetail({ jobs: [FAILED, JOB], onRetry: jest.fn() })

    expect(screen.getByText('in library')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: MOVIE_WATCH_LABEL }),
    ).toBeInTheDocument()

    const list = attempts()
    expect(list).toBeInTheDocument()
    expect(within(list as HTMLElement).getByText('failed')).toBeInTheDocument()
    expect(
      within(list as HTMLElement).getByText(FAILED.error ?? ''),
    ).toBeInTheDocument()
    // Retrying would re-grab a title that is already on disk.
    expect(
      screen.queryByRole('button', { name: /^retry$/i }),
    ).not.toBeInTheDocument()
  })

  it('offers Retry on a failed newest attempt while the movie is still wanted', async () => {
    const onRetry = jest.fn()
    const user = userEvent.setup()
    renderDetail({ jobs: [FAILED], media: WANTED, onRetry })

    await user.click(screen.getByRole('button', { name: /^retry$/i }))

    expect(onRetry).toHaveBeenCalledWith(FAILED.id)
  })

  it('chips a deleted movie "not downloaded" and keeps its old run as an attempt', () => {
    // Delete leaves a completed job row as history. It is an attempt that
    // happened, not a claim that the file is there.
    renderDetail({ jobs: [JOB], media: UNFETCHED })

    expect(screen.getByText('not downloaded')).toBeInTheDocument()
    expect(
      within(attempts() as HTMLElement).getByText('completed'),
    ).toBeInTheDocument()
    expect(downloadButton()).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: MOVIE_WATCH_LABEL }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: SAVE_LOCAL_LABEL }),
    ).not.toBeInTheDocument()
  })
})

/**
 * Plan 022. A download started in Radarr's own UI is adopted as an attempt;
 * an upgrade of the file on disk is not, and keeps the bar and the note.
 */
describe('MovieDetail — downloads Radarr started', () => {
  /** The poller's adoption of {@link RADARR_GRAB}: no requester, no Discord. */
  const ADOPTED: DownloadJob = {
    ...PENDING,
    id: 'job-adopted',
    media: RADARR_GRAB,
    requester: null,
    startedUpstream: true,
    status: DownloadJobStatus.Downloading,
  }

  it('offers Cancel on an adopted attempt, credits it to Radarr, and drops the note', async () => {
    const onCancel = jest.fn()
    const user = userEvent.setup()
    renderDetail({ jobs: [ADOPTED], media: RADARR_GRAB, onCancel })

    expect(screen.getByText('Radarr · 5m ago')).toBeInTheDocument()
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument()
    expect(
      screen.queryByText(MOVIE_EXTERNAL_QUEUE_NOTE),
    ).not.toBeInTheDocument()

    const card = document.querySelector(`[data-job-id="${ADOPTED.id}"]`)
    expect(card).toBeInstanceOf(HTMLElement)
    // Cancel, and never Pause — the movie has no pause route.
    expect(
      within(card as HTMLElement).queryByRole('button', { name: /^pause$/i }),
    ).not.toBeInTheDocument()

    await user.click(
      within(card as HTMLElement).getByRole('button', { name: /^cancel$/i }),
    )

    expect(onCancel).toHaveBeenCalledWith(ADOPTED.id)
  })

  it('keeps the bar and says why there is nothing to cancel for an upgrade', () => {
    // The newest attempt finished long ago; Radarr is now replacing its file.
    renderDetail({ jobs: [JOB], media: RADARR_UPGRADE, onCancel: jest.fn() })

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '47',
    )
    expect(screen.getByText(MOVIE_EXTERNAL_QUEUE_NOTE)).toBeInTheDocument()
    expect(MOVIE_EXTERNAL_QUEUE_NOTE).toBe(
      "Radarr is upgrading the file already on disk — it can't be cancelled here.",
    )
    expect(
      screen.queryByRole('button', { name: /^cancel$/i }),
    ).not.toBeInTheDocument()
  })
})

describe('MovieDetail — attempts', () => {
  it('highlights an in-flight attempt with Cancel, and hides the header Download', async () => {
    const onCancel = jest.fn()
    const user = userEvent.setup()
    renderDetail({ jobs: [PENDING], media: WANTED, onCancel })

    const card = document.querySelector(`[data-job-id="${PENDING.id}"]`)
    expect(card).toBeInstanceOf(HTMLElement)
    expect(card).toHaveClass('border-uv/35')
    expect(within(attempts() as HTMLElement).getByText('queued')).toBeVisible()
    // A press beside a grab already in flight would race it.
    expect(
      screen.queryByRole('button', { name: MOVIE_REQUEST_LABEL }),
    ).not.toBeInTheDocument()

    await user.click(
      within(card as HTMLElement).getByRole('button', { name: /^cancel$/i }),
    )

    expect(onCancel).toHaveBeenCalledWith(PENDING.id)
  })

  it('offers no pause, resume, cancel or retry when the page wires none', () => {
    renderDetail({ jobs: [PENDING], media: WANTED })

    for (const name of [/^pause$/i, /^resume$/i, /^cancel$/i, /^retry$/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('hands the importer through for a stuck import', async () => {
    const imports = {
      commit: jest.fn().mockResolvedValue({ importedCount: 1 }),
      discard: jest.fn().mockResolvedValue({ discardedCount: 1 }),
      list: jest.fn().mockResolvedValue({ candidates: [] }),
    }

    renderDetail({
      imports,
      jobs: [{ ...PENDING, status: DownloadJobStatus.NeedsAttention }],
      media: { ...UNFETCHED, state: 'needs_attention' },
    })

    await userEvent.click(firstButton(IMPORT_TRIGGER_LABEL))

    // A movie carries no scope at all - Radarr's import endpoints key on the
    // movie alone, so both narrowing fields go out undefined.
    await waitFor(() =>
      expect(imports.list).toHaveBeenCalledWith(MOVIE_ID, {
        episodeId: undefined,
        seasonNumber: undefined,
      }),
    )
  })

  it('offers no Import control when the page wired no importer', () => {
    renderDetail({
      jobs: [{ ...PENDING, status: DownloadJobStatus.NeedsAttention }],
      media: { ...UNFETCHED, state: 'needs_attention' },
    })

    expect(
      screen.queryByRole('button', { name: IMPORT_TRIGGER_LABEL }),
    ).not.toBeInTheDocument()
  })

  it('lists every attempt, newest first', () => {
    renderDetail({ jobs: [JOB, { ...FAILED, createdAt: EARLIER }] })

    const rows = within(attempts() as HTMLElement)
      .getAllByText(/^(completed|failed)$/)
      .map(chip => chip.textContent)

    expect(rows).toEqual(['completed', 'failed'])
  })
})

describe('MovieDetail — the live feed marker', () => {
  it('says it is reconnecting while a download is moving', () => {
    renderDetail({ jobs: [], media: RADARR_GRAB, stale: true })

    expect(screen.getByText(MOVIE_STALE_LABEL)).toBeInTheDocument()
  })

  it('stays quiet about a settled movie — there is no frame to miss', () => {
    renderDetail({ jobs: [JOB], stale: true })

    expect(screen.queryByText(MOVIE_STALE_LABEL)).not.toBeInTheDocument()
  })
})

describe('MovieDetail — the download shortcut', () => {
  it('passes the movie’s own media key to the handler, and nothing else', async () => {
    const onRequest = jest.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderDetail({ jobs: [], media: UNFETCHED, onRequest })

    await user.click(firstButton(MOVIE_REQUEST_LABEL))

    expect(onRequest).toHaveBeenCalledWith(MOVIE_ID)
  })

  it.each([
    ['downloading'] as const,
    ['importing'] as const,
    ['paused'] as const,
    ['needs_attention'] as const,
  ])('hides it while the movie is %s', state => {
    renderDetail({ jobs: [], media: { ...UNFETCHED, state } })

    expect(
      screen.queryByRole('button', { name: MOVIE_REQUEST_LABEL }),
    ).not.toBeInTheDocument()
  })
})

describe('MovieDetail — save and delete', () => {
  it('offers the local save once there is a file', () => {
    renderDetail()

    expect(
      screen.getByRole('link', { name: SAVE_LOCAL_LABEL }),
    ).toHaveAttribute('href', '/api/download/media/tmdb%3A438631/file')
  })

  it('offers neither save nor delete when there is no file', () => {
    renderDetail({ jobs: [], media: UNFETCHED })

    expect(
      screen.queryByRole('link', { name: SAVE_LOCAL_LABEL }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^delete$/i }),
    ).not.toBeInTheDocument()
  })

  it('names the movie and what survives before deleting anything', async () => {
    const user = userEvent.setup()
    const onDelete = jest.fn()

    renderDetail({ onDelete })
    await user.click(firstButton(/^delete$/i))

    const dialog = await screen.findByRole('dialog')
    const copy = deleteConfirmCopy({ kind: 'movie' }, { title: MOVIE.title })

    expect(within(dialog).getByText(copy.title)).toBeInTheDocument()
    expect(within(dialog).getByText(copy.description)).toBeInTheDocument()
    // Opening the dialog must not have deleted anything.
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('deletes every file of the movie — the empty query, never a scoped one', async () => {
    const user = userEvent.setup()
    const onDelete = jest.fn().mockResolvedValue({ deletedCount: 1 })

    renderDetail({ onDelete })
    await user.click(firstButton(/^delete$/i))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith(MOVIE_ID, {})
    })
  })
})

describe('MovieDetail — the release picker', () => {
  it('never searches on mount', async () => {
    const onSearch = jest.fn()

    renderDetail({ onSearch })

    // ⚠️ `GET /media/:id/releases` writes upstream — it borrows Radarr's
    // monitoring to ask and puts it back. Firing it on navigation would
    // mutate a library as a side effect of looking at a page.
    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: RELEASE_SEARCH_LABEL })[0],
      ).toBeInTheDocument()
    })
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('searches only when the picker’s own trigger is pressed', async () => {
    const user = userEvent.setup()
    const onSearch = jest.fn().mockResolvedValue({ releases: [ALTERNATIVE] })

    renderDetail({ onSearch })
    await user.click(firstButton(RELEASE_SEARCH_LABEL))

    await waitFor(() => {
      expect(onSearch).toHaveBeenCalledTimes(1)
    })
  })

  it('scopes nothing — a movie passes neither episodeId nor seasonNumber', async () => {
    const user = userEvent.setup()
    const onSearch = jest.fn().mockResolvedValue({ releases: [ALTERNATIVE] })

    renderDetail({ onSearch })
    await user.click(firstButton(RELEASE_SEARCH_LABEL))

    await waitFor(() => {
      expect(onSearch).toHaveBeenCalledWith(MOVIE_ID, {
        episodeId: undefined,
        seasonNumber: undefined,
      })
    })
  })

  it('makes every pick a replace while a file is on disk', async () => {
    const user = userEvent.setup()
    const onSearch = jest.fn().mockResolvedValue({ releases: [ALTERNATIVE] })
    const onReplace = jest.fn().mockResolvedValue({ job: JOB })
    const onGrab = jest.fn()

    renderDetail({ onGrab, onReplace, onSearch })
    await user.click(firstButton(RELEASE_SEARCH_LABEL))
    await user.click(
      await screen.findByRole('button', {
        name: RELEASE_REPLACE_LABEL,
      }),
    )

    await waitFor(() => {
      expect(onReplace).toHaveBeenCalledWith(MOVIE_ID, {
        episodeId: undefined,
        guid: ALTERNATIVE.guid,
        indexerId: ALTERNATIVE.indexerId,
        seasonNumber: undefined,
      })
    })
    // One call that deletes and grabs together — never a delete first.
    expect(onGrab).not.toHaveBeenCalled()
  })

  it('grabs rather than replaces when there is nothing on disk', async () => {
    const user = userEvent.setup()
    const onSearch = jest.fn().mockResolvedValue({ releases: [ALTERNATIVE] })
    const onGrab = jest.fn().mockResolvedValue({ job: JOB })

    renderDetail({ jobs: [], media: UNFETCHED, onGrab, onSearch })
    await user.click(firstButton(RELEASE_SEARCH_LABEL))
    await user.click(
      await screen.findByRole('button', {
        name: RELEASE_GRAB_LABEL,
      }),
    )

    await waitFor(() => {
      expect(onGrab).toHaveBeenCalledWith(MOVIE_ID, {
        episodeId: undefined,
        guid: ALTERNATIVE.guid,
        indexerId: ALTERNATIVE.indexerId,
        seasonNumber: undefined,
      })
    })
  })

  it('carries the title’s flags into the list', async () => {
    const user = userEvent.setup()
    const onSearch = jest
      .fn()
      .mockResolvedValue({ releases: [{ ...ALTERNATIVE, flaggedBad: true }] })

    renderDetail({ badFiles: [FLAG], onSearch })
    await user.click(firstButton(RELEASE_SEARCH_LABEL))

    expect(await screen.findByText('bad file')).toBeInTheDocument()
  })

  it('⚠️ renders exactly as before when the file traces back to no release', async () => {
    const user = userEvent.setup()
    const releases = [CURRENT, ALTERNATIVE]
    const onSearch = jest.fn().mockResolvedValue({ releases })

    // `MOVIE` carries no `currentReleaseGuid`: a manual import, a pruned
    // history, a degraded resolver. Absent must be indistinguishable from the
    // old behaviour — no chip, no report control, and no row special-cased.
    renderDetail({ onFlag: jest.fn(), onReplace: jest.fn(), onSearch })
    await user.click(firstButton(RELEASE_SEARCH_LABEL))

    await screen.findAllByRole('button', { name: RELEASE_REPLACE_LABEL })
    expect(screen.queryByText(RELEASE_CURRENT_LABEL)).not.toBeInTheDocument()
    // ⚠️ The report control is on *every* row now, so its presence no longer
    // marks a row as the current one — only the chip does. What "no guid"
    // buys is that no row is singled out: same chip-less list, same count of
    // every control on it.
    expect(screen.getAllByRole('button', { name: REPORT_LABEL })).toHaveLength(
      releases.length,
    )

    // ⚠️ `hasFile` still decides the verb, so every row stays a replace —
    // including the synthesized current-release row, which is just another
    // pickable row once no guid singles it out. This is the assertion that
    // catches `hasFile` regressing to `currentGuid !== undefined`: the two
    // negatives above would still pass, and every one of these would silently
    // flip to a grab. `show-episode-row.spec.tsx` pins the same invariant.
    //
    // One button per release, not two: each picker keeps its own search
    // state, so only the copy whose trigger was pressed has a list at all.
    expect(
      screen.getAllByRole('button', { name: RELEASE_REPLACE_LABEL }),
    ).toHaveLength(releases.length)
    expect(
      screen.queryByRole('button', { name: RELEASE_GRAB_LABEL }),
    ).not.toBeInTheDocument()
  })

  it('chips the release behind the file on disk and offers to report it', async () => {
    const user = userEvent.setup()
    const onSearch = jest
      .fn()
      .mockResolvedValue({ releases: [CURRENT, ALTERNATIVE] })

    renderDetail({
      media: ON_DISK,
      onFlag: jest.fn(),
      onReplace: jest.fn(),
      onSearch,
    })
    await user.click(firstButton(RELEASE_SEARCH_LABEL))
    await screen.findAllByRole('button', { name: RELEASE_REPLACE_LABEL })

    const current = releaseRow(CURRENT)

    expect(within(current).getByText(RELEASE_CURRENT_LABEL)).toBeInTheDocument()
    expect(
      within(current).getByRole('button', { name: REPORT_LABEL }),
    ).toBeInTheDocument()

    // The current row is the one you report; every other row is one you take.
    const alternative = releaseRow(ALTERNATIVE)

    expect(
      within(alternative).queryByText(RELEASE_CURRENT_LABEL),
    ).not.toBeInTheDocument()
    expect(
      within(alternative).getByRole('button', { name: RELEASE_REPLACE_LABEL }),
    ).toBeInTheDocument()
  })

  it('renders the synthesized current row by its title when it has no quality', async () => {
    const user = userEvent.setup()
    const onSearch = jest.fn().mockResolvedValue({ releases: [CURRENT] })

    renderDetail({ media: ON_DISK, onFlag: jest.fn(), onSearch })
    await user.click(firstButton(RELEASE_SEARCH_LABEL))
    await screen.findAllByText(RELEASE_CURRENT_LABEL)

    // A row rebuilt from history carries no `QualityModel` and no size, so
    // the primary column falls back to the raw release name. Intended.
    expect(
      within(releaseRow(CURRENT)).getAllByText(CURRENT.title).length,
    ).toBeGreaterThan(0)
  })

  it('shows the reported state when the file on disk is already flagged', async () => {
    const user = userEvent.setup()
    const onSearch = jest
      .fn()
      .mockResolvedValue({ releases: [CURRENT, ALTERNATIVE] })

    renderDetail({
      badFiles: [CURRENT_FLAG],
      media: ON_DISK,
      onFlag: jest.fn(),
      onReplace: jest.fn(),
      onSearch,
      onUnflag: jest.fn(),
    })
    await user.click(firstButton(RELEASE_SEARCH_LABEL))
    await screen.findAllByRole('button', { name: RELEASE_REPLACE_LABEL })

    const current = releaseRow(CURRENT)

    // A second report is structurally unreachable, not merely refused.
    expect(within(current).getByText(REPORTED_LABEL)).toBeInTheDocument()
    expect(
      within(current).queryByRole('button', { name: REPORT_LABEL }),
    ).not.toBeInTheDocument()
    expect(
      within(current).getByRole('button', { name: UNDO_REPORT_LABEL }),
    ).toBeInTheDocument()
  })

  it('never searches on mount, guid or no guid', async () => {
    const onSearch = jest.fn()

    renderDetail({ media: ON_DISK, onFlag: jest.fn(), onSearch })

    // Knowing which release is current must not become a reason to go looking
    // for the rest of them — `GET /media/:id/releases` still writes upstream.
    await waitFor(() => {
      expect(firstButton(RELEASE_SEARCH_LABEL)).toBeInTheDocument()
    })
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('renders one picker per layout, both fed the same media key', () => {
    renderDetail()

    expect(
      screen.getAllByRole('button', { name: RELEASE_SEARCH_LABEL }),
    ).toHaveLength(2)
  })
})
