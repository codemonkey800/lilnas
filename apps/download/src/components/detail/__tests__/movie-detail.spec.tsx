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
import { JOB_LIFECYCLE_EMPTY_LABEL } from 'src/components/detail/job-state'
import type { MovieDetailProps } from 'src/components/detail/movie-detail'
import {
  isMetadataUnavailable,
  MOVIE_EMBY_UNAVAILABLE_LABEL,
  MOVIE_EMPTY_NOTE,
  MOVIE_INDEXING_LABEL,
  MOVIE_LIBRARY_NOTE,
  MOVIE_METADATA_NOTE,
  MOVIE_STATUS_LABEL,
  MOVIE_WATCH_LABEL,
  MovieDetail,
  movieMetaLine,
  movieWatchState,
} from 'src/components/detail/movie-detail'
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
  title: 'Salt & Ceremony',
  tmdbId: 438631,
  type: DownloadType.Movie,
  year: 2024,
}

/** Requested but with nothing on disk yet — no `filePath`, so no `embyStatus`. */
const UNFETCHED: Movie = {
  ...MOVIE,
  embyStatus: undefined,
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
  hiddenAttribution: false,
  id: 'job-1',
  media: MOVIE,
  requester: { email: 'jeremy.asuncion@lilnas.io', userId: 'u_jeremy' },
  status: DownloadJobStatus.Completed,
  updatedAt: '2026-09-15T11:48:00.000Z',
}

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
 * from carries no `QualityModel` and no indexer id. `ReleaseRow`'s
 * `[quality, size] || title` fallback therefore renders the raw release title
 * for it, which is the intended path rather than a gap.
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
    <MovieDetail jobs={[JOB]} movie={MOVIE} now={NOW} {...overrides} />,
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
    renderDetail({ movie: { ...MOVIE, embyStatus: { state: 'indexing' } } })

    expect(
      screen.queryByRole('link', { name: MOVIE_WATCH_LABEL }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(MOVIE_INDEXING_LABEL)).toBeInTheDocument()
  })

  it('says Emby could not be asked when its lookup failed', () => {
    renderDetail({ movie: { ...MOVIE, embyStatus: { state: 'unknown' } } })

    expect(
      screen.queryByRole('link', { name: MOVIE_WATCH_LABEL }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(MOVIE_EMBY_UNAVAILABLE_LABEL)).toBeInTheDocument()
  })

  it('draws neither a Watch nor an indexing state when there is no file', () => {
    renderDetail({ jobs: [], movie: UNFETCHED })

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
      movie: {
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
})

describe('MovieDetail — the lifecycle panel', () => {
  it('labels the panel and shows the job status', () => {
    renderDetail()

    expect(
      screen.getByRole('heading', { level: 2, name: MOVIE_STATUS_LABEL }),
    ).toBeInTheDocument()
    expect(screen.getByText('completed')).toBeInTheDocument()
  })

  it('renders the empty state for a movie with neither job nor file', () => {
    renderDetail({ jobs: [], movie: UNFETCHED })

    expect(screen.getByText(JOB_LIFECYCLE_EMPTY_LABEL)).toBeInTheDocument()
    expect(screen.getByText(MOVIE_EMPTY_NOTE)).toBeInTheDocument()
  })

  it('does not say "nothing grabbed" about a movie that is already on disk', () => {
    // The common state on this page: Radarr's library is full of titles this
    // app never fetched. `not downloaded` is true of the job and false of the
    // file, so the note beside it has to say which.
    renderDetail({ jobs: [] })

    expect(screen.getByText(MOVIE_LIBRARY_NOTE)).toBeInTheDocument()
    expect(screen.queryByText(MOVIE_EMPTY_NOTE)).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: MOVIE_WATCH_LABEL }),
    ).toBeInTheDocument()
  })

  it('offers no pause, resume, cancel or retry — those routes are video-only', () => {
    renderDetail({
      jobs: [
        { ...JOB, completedAt: null, status: DownloadJobStatus.Downloading },
      ],
    })

    for (const name of [/^pause$/i, /^resume$/i, /^cancel$/i, /^retry$/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('draws the Radarr queue percentage when the snapshot carries one', () => {
    renderDetail({
      jobs: [
        {
          ...JOB,
          completedAt: null,
          media: {
            ...MOVIE,
            queueSnapshot: {
              progress: 47,
              status: 'downloading',
              timeLeft: '00:12:30',
            },
          },
          status: DownloadJobStatus.Downloading,
        },
      ],
    })

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '47',
    )
  })

  it('draws no bar at all when there is no queue snapshot', () => {
    renderDetail({
      jobs: [
        { ...JOB, completedAt: null, status: DownloadJobStatus.Downloading },
      ],
    })

    // A 0% bar is a claim. `jobProgress` answering null means "draw nothing".
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('lists earlier attempts under the current one', () => {
    renderDetail({
      jobs: [
        JOB,
        {
          ...JOB,
          createdAt: '2026-09-15T10:00:00.000Z',
          error: 'Stopped responding partway through.',
          id: 'job-0',
          status: DownloadJobStatus.Failed,
        },
      ],
    })

    expect(screen.getByText('Earlier attempts')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
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
    renderDetail({ jobs: [], movie: UNFETCHED })

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

    renderDetail({ jobs: [], movie: UNFETCHED, onGrab, onSearch })
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

  it('marks no row current and offers no report control without a guid', async () => {
    const user = userEvent.setup()
    const onSearch = jest
      .fn()
      .mockResolvedValue({ releases: [CURRENT, ALTERNATIVE] })

    // `MOVIE` carries no `currentReleaseGuid`: the file was imported by hand,
    // or the history that named its release has since been pruned. Passing
    // `undefined` has to be indistinguishable from never passing the prop at
    // all — no chip, no report control, every row still grabbable.
    renderDetail({ onFlag: jest.fn(), onReplace: jest.fn(), onSearch })
    await user.click(firstButton(RELEASE_SEARCH_LABEL))

    await screen.findAllByRole('button', { name: RELEASE_REPLACE_LABEL })
    expect(screen.queryByText(RELEASE_CURRENT_LABEL)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: REPORT_LABEL }),
    ).not.toBeInTheDocument()
  })

  it('chips the release behind the file on disk and offers to report it', async () => {
    const user = userEvent.setup()
    const onSearch = jest
      .fn()
      .mockResolvedValue({ releases: [CURRENT, ALTERNATIVE] })

    renderDetail({
      movie: ON_DISK,
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

    renderDetail({ movie: ON_DISK, onFlag: jest.fn(), onSearch })
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
      movie: ON_DISK,
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

    renderDetail({ movie: ON_DISK, onFlag: jest.fn(), onSearch })

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
