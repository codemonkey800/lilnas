import '@testing-library/jest-dom'

import type { BadFile, Release } from '@lilnas/utils/download/types'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  formatBytes,
  RELEASE_CURRENT_LABEL,
  RELEASE_EMPTY_NOTE,
  RELEASE_FLAGGED_LABEL,
  RELEASE_FLAGGED_REASON,
  RELEASE_GRAB_LABEL,
  RELEASE_REJECTED_REASON,
  RELEASE_REPLACE_LABEL,
  RELEASE_SEARCH_LABEL,
  RELEASE_SEARCH_NOTE,
  RELEASE_SECTION_LABEL,
  ReleasePicker,
} from 'src/components/detail/release-picker'

const MOVIE_ID = 'tmdb:438631'
const SHOW_ID = 'tvdb:121361'

const GB = 1024 ** 3
const MB = 1024 ** 2

const CURRENT: Release = {
  downloadAllowed: true,
  flaggedBad: false,
  guid: 'guid-current',
  indexer: 'yts-verified',
  indexerId: 3,
  quality: { name: '1080p WEB-DL', resolution: 1080 },
  rejected: false,
  size: 2.1 * GB,
  title: 'Dune.2021.1080p.WEB-DL.x264-YTS',
}

const ALTERNATIVE: Release = {
  downloadAllowed: true,
  flaggedBad: false,
  guid: 'guid-2160',
  indexer: 'nyaa-hd',
  indexerId: 4,
  quality: { name: '2160p WEB-DL', resolution: 2160 },
  rejected: false,
  size: 5.8 * GB,
  title: 'Dune.2021.2160p.WEB-DL.HDR-NYAA',
}

const FLAGGED: Release = {
  downloadAllowed: true,
  flaggedBad: true,
  guid: 'guid-bad',
  indexer: 'low-seed-source',
  indexerId: 5,
  quality: { name: '720p HDTV', resolution: 720 },
  rejected: false,
  size: 900 * MB,
  title: 'Dune.2021.720p.HDTV.x264',
}

const REJECTED: Release = {
  downloadAllowed: false,
  flaggedBad: false,
  guid: 'guid-rejected',
  indexer: 'some-indexer',
  indexerId: 6,
  quality: { name: '480p DVD', resolution: 480 },
  rejected: true,
  rejections: ['Quality DVD is not wanted in profile'],
  size: 700 * MB,
  title: 'Dune.2021.480p.DVDRip',
}

const FLAG: BadFile = {
  createdAt: '2026-09-15T12:00:00.000Z',
  flaggedBy: { email: 'jeremy@lilnas.io', userId: 'u_1' },
  id: 7,
  indexerId: 5,
  mediaId: MOVIE_ID,
  reason: "Video won't play",
  releaseGuid: 'guid-bad',
  releaseTitle: FLAGGED.title,
}

/** The row a release renders into — the `title` attribute carries its full name. */
function row(release: Release): HTMLElement {
  const element = document.querySelector(`[title="${release.title}"]`)

  if (!(element instanceof HTMLElement)) {
    throw new Error(`no row for ${release.title}`)
  }

  return element
}

describe('formatBytes', () => {
  it.each([
    [2.1 * GB, '2.1 GB'],
    [5.8 * GB, '5.8 GB'],
    [900 * MB, '900 MB'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
  ])('renders %p as %p, exactly as the mockups spell it', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })

  it.each([
    [null],
    [undefined],
    [0],
    [-1],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
  ])('answers with the em dash for %p rather than "0 B"', value => {
    // Same contract `formatRuntime` keeps: absent is an em dash, never a
    // plausible-looking zero.
    expect(formatBytes(value)).toBe('—')
  })
})

describe('ReleasePicker — the search is never speculative', () => {
  it('⚠️ does NOT call onSearch on mount', async () => {
    // `GET /download/media/:id/releases` fires a real indexer sweep AND writes
    // upstream (it borrows Radarr/Sonarr monitoring to ask). A render must
    // never trigger it — otherwise simply navigating to a detail page, or
    // Next prefetching a link to one, mutates a real library.
    const onSearch = jest.fn()

    render(<ReleasePicker mediaId={MOVIE_ID} onSearch={onSearch} />)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: RELEASE_SEARCH_LABEL }),
      ).toBeInTheDocument()
    })
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('does not call onSearch on hover or focus either', async () => {
    const user = userEvent.setup()
    const onSearch = jest.fn()

    render(<ReleasePicker mediaId={MOVIE_ID} onSearch={onSearch} />)

    const trigger = screen.getByRole('button', { name: RELEASE_SEARCH_LABEL })

    await user.hover(trigger)
    await user.tab()

    expect(onSearch).not.toHaveBeenCalled()
  })

  it('says what the search will cost before running it', () => {
    render(<ReleasePicker mediaId={MOVIE_ID} onSearch={jest.fn()} />)

    expect(screen.getByText(RELEASE_SEARCH_NOTE)).toBeInTheDocument()
  })

  it('calls onSearch once, on the press, and renders what came back', async () => {
    const user = userEvent.setup()
    const onSearch = jest
      .fn()
      .mockResolvedValue({ releases: [CURRENT, ALTERNATIVE] })

    render(<ReleasePicker mediaId={MOVIE_ID} onSearch={onSearch} />)

    await user.click(screen.getByRole('button', { name: RELEASE_SEARCH_LABEL }))

    expect(onSearch).toHaveBeenCalledTimes(1)
    expect(onSearch).toHaveBeenCalledWith(MOVIE_ID, {
      episodeId: undefined,
      seasonNumber: undefined,
    })
    expect(await screen.findByText('1080p WEB-DL · 2.1 GB')).toBeInTheDocument()
  })

  it('carries a show scope into the search', async () => {
    const user = userEvent.setup()
    const onSearch = jest.fn().mockResolvedValue({ releases: [] })

    render(
      <ReleasePicker
        episodeId={4823}
        mediaId={SHOW_ID}
        seasonNumber={2}
        onSearch={onSearch}
      />,
    )

    await user.click(screen.getByRole('button', { name: RELEASE_SEARCH_LABEL }))

    expect(onSearch).toHaveBeenCalledWith(SHOW_ID, {
      episodeId: 4823,
      seasonNumber: 2,
    })
  })

  it('treats an empty result as "nothing found", not as an error', async () => {
    const user = userEvent.setup()

    render(
      <ReleasePicker
        mediaId={MOVIE_ID}
        onSearch={jest.fn().mockResolvedValue({ releases: [] })}
      />,
    )

    await user.click(screen.getByRole('button', { name: RELEASE_SEARCH_LABEL }))

    expect(await screen.findByText(RELEASE_EMPTY_NOTE)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('surfaces a failed search as copy', async () => {
    const user = userEvent.setup()

    render(
      <ReleasePicker
        mediaId={MOVIE_ID}
        onSearch={jest.fn().mockResolvedValue({ error: 'No indexer answered' })}
      />,
    )

    await user.click(screen.getByRole('button', { name: RELEASE_SEARCH_LABEL }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No indexer answered',
    )
  })
})

describe('ReleasePicker — the list', () => {
  it('renders the section heading and the two mono columns', () => {
    render(<ReleasePicker mediaId={MOVIE_ID} releases={[CURRENT]} />)

    expect(
      screen.getByRole('heading', { name: RELEASE_SECTION_LABEL }),
    ).toBeInTheDocument()
    expect(screen.getByText('1080p WEB-DL · 2.1 GB')).toBeInTheDocument()
    expect(screen.getByText('yts-verified')).toBeInTheDocument()
  })

  it('chips the release that is currently on disk', () => {
    render(
      <ReleasePicker
        currentGuid={CURRENT.guid}
        mediaId={MOVIE_ID}
        releases={[CURRENT, ALTERNATIVE]}
      />,
    )

    expect(
      within(row(CURRENT)).getByText(RELEASE_CURRENT_LABEL),
    ).toBeInTheDocument()
    expect(
      within(row(ALTERNATIVE)).queryByText(RELEASE_CURRENT_LABEL),
    ).not.toBeInTheDocument()
  })

  it('keeps the full release name reachable, which no mockup column shows', () => {
    render(<ReleasePicker mediaId={MOVIE_ID} releases={[ALTERNATIVE]} />)

    expect(row(ALTERNATIVE)).toHaveAttribute('title', ALTERNATIVE.title)
  })
})

describe('ReleasePicker — a flagged release is disabled WITH A REASON', () => {
  function renderFlagged() {
    return render(
      <ReleasePicker
        currentGuid={CURRENT.guid}
        mediaId={MOVIE_ID}
        releases={[CURRENT, FLAGGED]}
        onGrab={jest.fn()}
        onReplace={jest.fn()}
      />,
    )
  }

  it('chips it `bad file` and strikes the row through', () => {
    renderFlagged()

    const flagged = row(FLAGGED)

    expect(within(flagged).getByText(RELEASE_FLAGGED_LABEL)).toBeInTheDocument()
    expect(flagged.getAttribute('class')).toContain('opacity-55')
    expect(
      within(flagged).getByText('720p HDTV · 900 MB').getAttribute('class'),
    ).toContain('line-through')
  })

  it('says why, rather than letting the user find out by clicking', () => {
    // The backend answers a grab of a flagged release with 409. The reason is
    // rendered as visible text, not a tooltip.
    renderFlagged()

    expect(
      within(row(FLAGGED)).getByText(RELEASE_FLAGGED_REASON),
    ).toBeInTheDocument()
  })

  it('wires the reason to the control as its accessible description', () => {
    renderFlagged()

    const control = within(row(FLAGGED)).getByRole('button', {
      name: RELEASE_REPLACE_LABEL,
    })
    const describedBy = control.getAttribute('aria-describedby')

    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      RELEASE_FLAGGED_REASON,
    )
  })

  it('uses aria-disabled, NOT disabled, so the reason stays reachable', () => {
    // A real `disabled` attribute drops the button out of the focus order, and
    // with it the `aria-describedby` that carries the reason. jsdom implements
    // neither `inert` nor disabled-blur semantics, so the assertion is on tab
    // reachability rather than on focus behaviour.
    renderFlagged()

    const control = within(row(FLAGGED)).getByRole('button', {
      name: RELEASE_REPLACE_LABEL,
    })

    expect(control).toHaveAttribute('aria-disabled', 'true')
    expect(control).not.toBeDisabled()
    expect(control.tabIndex).toBeGreaterThanOrEqual(0)
  })

  it('refuses the click', async () => {
    const user = userEvent.setup()
    const onReplace = jest.fn()

    render(
      <ReleasePicker
        currentGuid={CURRENT.guid}
        mediaId={MOVIE_ID}
        releases={[CURRENT, FLAGGED]}
        onReplace={onReplace}
      />,
    )

    await user.click(
      within(row(FLAGGED)).getByRole('button', {
        name: RELEASE_REPLACE_LABEL,
      }),
    )

    expect(onReplace).not.toHaveBeenCalled()
  })

  it('reports an upstream rejection in upstream’s own words', () => {
    render(
      <ReleasePicker
        mediaId={MOVIE_ID}
        releases={[REJECTED]}
        onGrab={jest.fn()}
      />,
    )

    expect(
      within(row(REJECTED)).getByText('Quality DVD is not wanted in profile'),
    ).toBeInTheDocument()
  })

  it('falls back to its own sentence when upstream gave no rejection text', () => {
    render(
      <ReleasePicker
        mediaId={MOVIE_ID}
        releases={[{ ...REJECTED, rejections: undefined }]}
        onGrab={jest.fn()}
      />,
    )

    expect(
      within(row(REJECTED)).getByText(RELEASE_REJECTED_REASON),
    ).toBeInTheDocument()
  })
})

describe('ReleasePicker — replace is ONE flow', () => {
  it('issues a single replace, never a delete followed by a grab', async () => {
    // ⚠️ The task's central edge case. `ReleasePicker` is given no delete
    // action *at all* — there is no prop for one — so the only way it can swap
    // a file is the single atomic `replaceRelease` call. `onGrab` is passed
    // here precisely so the test can prove it was not used.
    const user = userEvent.setup()
    const onGrab = jest.fn()
    const onReplace = jest.fn().mockResolvedValue({ job: { id: 'job_1' } })

    render(
      <ReleasePicker
        currentGuid={CURRENT.guid}
        mediaId={MOVIE_ID}
        releases={[CURRENT, ALTERNATIVE]}
        onGrab={onGrab}
        onReplace={onReplace}
      />,
    )

    await user.click(
      within(row(ALTERNATIVE)).getByRole('button', {
        name: RELEASE_REPLACE_LABEL,
      }),
    )

    expect(onReplace).toHaveBeenCalledTimes(1)
    expect(onReplace).toHaveBeenCalledWith(MOVIE_ID, {
      episodeId: undefined,
      guid: ALTERNATIVE.guid,
      indexerId: ALTERNATIVE.indexerId,
      seasonNumber: undefined,
    })
    expect(onGrab).not.toHaveBeenCalled()
  })

  it('labels the action "Replace with this" only when a file is there', () => {
    const { rerender } = render(
      <ReleasePicker
        mediaId={MOVIE_ID}
        releases={[ALTERNATIVE]}
        onGrab={jest.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: RELEASE_GRAB_LABEL }),
    ).toBeInTheDocument()

    rerender(
      <ReleasePicker
        hasFile
        mediaId={MOVIE_ID}
        releases={[ALTERNATIVE]}
        onGrab={jest.fn()}
        onReplace={jest.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: RELEASE_REPLACE_LABEL }),
    ).toBeInTheDocument()
  })

  it('grabs — not replaces — when there is no file yet', async () => {
    const user = userEvent.setup()
    const onGrab = jest.fn().mockResolvedValue({ job: { id: 'job_1' } })
    const onReplace = jest.fn()

    render(
      <ReleasePicker
        mediaId={SHOW_ID}
        episodeId={4823}
        releases={[ALTERNATIVE]}
        seasonNumber={2}
        onGrab={onGrab}
        onReplace={onReplace}
      />,
    )

    await user.click(screen.getByRole('button', { name: RELEASE_GRAB_LABEL }))

    expect(onGrab).toHaveBeenCalledWith(SHOW_ID, {
      episodeId: 4823,
      guid: ALTERNATIVE.guid,
      indexerId: ALTERNATIVE.indexerId,
      seasonNumber: 2,
    })
    expect(onReplace).not.toHaveBeenCalled()
  })

  it('renders a refused grab as copy next to the list', async () => {
    const user = userEvent.setup()

    render(
      <ReleasePicker
        mediaId={MOVIE_ID}
        releases={[ALTERNATIVE]}
        onGrab={jest.fn().mockResolvedValue({
          error: 'That release is reported as a bad file',
        })}
      />,
    )

    await user.click(screen.getByRole('button', { name: RELEASE_GRAB_LABEL }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That release is reported as a bad file',
    )
  })
})

describe('ReleasePicker — reporting from the list', () => {
  it('offers the report control on the current release only', () => {
    render(
      <ReleasePicker
        currentGuid={CURRENT.guid}
        mediaId={MOVIE_ID}
        releases={[CURRENT, ALTERNATIVE]}
        onFlag={jest.fn()}
        onReplace={jest.fn()}
      />,
    )

    expect(
      within(row(CURRENT)).getByRole('button', { name: 'Report a problem' }),
    ).toBeInTheDocument()
    expect(
      within(row(ALTERNATIVE)).queryByRole('button', {
        name: 'Report a problem',
      }),
    ).not.toBeInTheDocument()
  })

  it('shows an existing flag as already reported, with no trigger to press again', () => {
    render(
      <ReleasePicker
        badFiles={[FLAG]}
        currentGuid={FLAGGED.guid}
        mediaId={MOVIE_ID}
        releases={[FLAGGED]}
        onFlag={jest.fn()}
      />,
    )

    expect(within(row(FLAGGED)).getByText('reported')).toBeInTheDocument()
    expect(
      within(row(FLAGGED)).queryByRole('button', { name: 'Report a problem' }),
    ).not.toBeInTheDocument()
  })
})
