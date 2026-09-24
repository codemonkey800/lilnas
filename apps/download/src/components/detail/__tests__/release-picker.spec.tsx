import '@testing-library/jest-dom'

import type { BadFile, Release } from '@lilnas/utils/download/types'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  blockedReleaseReasons,
  formatRejection,
  RELEASE_ALL_BLOCKED_NOTE,
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
  releaseBlockReason,
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

/**
 * The shape the live search actually returns for the release already on disk:
 * the `current` row, carrying upstream's own rejection of it.
 *
 * ⚠️ `toCurrentRelease` forces `downloadAllowed: true` / `rejected: false` on
 * the row it *synthesizes*, and this is the case that protection does not
 * cover — the indexer genuinely had the release, so it arrives rejected.
 */
const CURRENT_REJECTED: Release = {
  ...CURRENT,
  downloadAllowed: false,
  rejected: true,
  rejections: ['Existing file meets cutoff: WEBDL-1080p []'],
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

describe('formatRejection', () => {
  it('drops the empty custom-format list Radarr serializes literally', () => {
    // Observed live. Sonarr renders the same refusal as `… cutoff: SDTV`.
    expect(formatRejection('Existing file meets cutoff: WORKPRINT []')).toBe(
      'Existing file meets cutoff: WORKPRINT',
    )
  })

  it('closes up the gap an inline empty list leaves behind', () => {
    expect(
      formatRejection('Existing file meets cutoff: SDTV [] is wanted'),
    ).toBe('Existing file meets cutoff: SDTV is wanted')
  })

  it('leaves a non-empty bracket group alone — that is real information', () => {
    expect(formatRejection('Existing file meets cutoff: SDTV [x264]')).toBe(
      'Existing file meets cutoff: SDTV [x264]',
    )
  })

  it.each([
    ['Quality WEBDL-2160p is wanted'],
    ['Not a preferred word upgrade for existing release'],
  ])('re-authors nothing: %p survives verbatim', text => {
    expect(formatRejection(text)).toBe(text)
  })

  it('answers empty for a rejection that was only an artifact', () => {
    expect(formatRejection('  []  ')).toBe('')
  })
})

describe('releaseBlockReason', () => {
  it('⚠️ never blocks the current row, even when upstream rejected it', () => {
    // The whole point of fix 1: `Existing file meets cutoff` is upstream
    // describing the file you already have. True, and useless.
    expect(releaseBlockReason(CURRENT_REJECTED, true)).toBeNull()
  })

  it('blocks that same release when it is NOT the current one', () => {
    expect(releaseBlockReason(CURRENT_REJECTED, false)).toBe(
      'Existing file meets cutoff: WEBDL-1080p',
    )
  })

  it('still blocks a flagged release that is also the current one', () => {
    // This app's own refusal, asked for by the user — and the chip reads
    // `bad file` rather than `current` for it.
    expect(releaseBlockReason(FLAGGED, true)).toBe(RELEASE_FLAGGED_REASON)
  })

  it('falls back to its own sentence when every rejection was an artifact', () => {
    expect(releaseBlockReason({ ...REJECTED, rejections: ['[]'] })).toBe(
      RELEASE_REJECTED_REASON,
    )
  })

  it('answers null for a release that can simply be taken', () => {
    expect(releaseBlockReason(ALTERNATIVE)).toBeNull()
  })
})

describe('blockedReleaseReasons', () => {
  it('de-duplicates, because 72 rows give three reasons', () => {
    expect(blockedReleaseReasons(['a', 'a', null, 'b'])).toEqual(['a', 'b'])
  })

  it('caps the summary rather than repeating a whole list into a note', () => {
    expect(blockedReleaseReasons(['a', 'b', 'c', 'd', 'e'])).toEqual([
      'a',
      'b',
      'c',
    ])
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
  it('renders the section heading and the three mono columns', () => {
    render(<ReleasePicker mediaId={MOVIE_ID} releases={[CURRENT]} />)

    expect(
      screen.getByRole('heading', { name: RELEASE_SECTION_LABEL }),
    ).toBeInTheDocument()
    expect(screen.getByText('1080p WEB-DL · 2.1 GB')).toBeInTheDocument()
    expect(screen.getByText(CURRENT.title)).toBeInTheDocument()
    expect(screen.getByText('yts-verified')).toBeInTheDocument()
  })

  it('⚠️ renders the release title as VISIBLE text, not only as a tooltip', () => {
    // Measured cost of the hover-only arrangement: one title returned 72 rows
    // all reading `WEBDL-1080p · 2.5 GB / NzbGeek`, many byte-identical.
    // `Release.title` is the only field that truly identifies a release, and a
    // `title` attribute is invisible on touch and unreliable to a screen
    // reader.
    render(
      <ReleasePicker mediaId={MOVIE_ID} releases={[CURRENT, ALTERNATIVE]} />,
    )

    expect(within(row(CURRENT)).getByText(CURRENT.title)).toBeInTheDocument()
    expect(
      within(row(ALTERNATIVE)).getByText(ALTERNATIVE.title),
    ).toBeInTheDocument()
  })

  it('does not repeat the title in the quality column when there is no quality', () => {
    const bare: Release = {
      downloadAllowed: true,
      flaggedBad: false,
      guid: 'guid-bare',
      indexer: 'some-indexer',
      indexerId: 9,
      rejected: false,
      title: 'Some.Unqualified.Release',
    }

    render(<ReleasePicker mediaId={MOVIE_ID} releases={[bare]} />)

    expect(within(row(bare)).getByText(bare.title)).toBeInTheDocument()
    expect(within(row(bare)).getByText('—')).toBeInTheDocument()
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

describe('ReleasePicker — a `current` row is never rendered as blocked', () => {
  function renderCurrentRejected() {
    return render(
      <ReleasePicker
        currentGuid={CURRENT.guid}
        mediaId={MOVIE_ID}
        releases={[CURRENT_REJECTED, ALTERNATIVE]}
        onFlag={jest.fn()}
        onReplace={jest.fn()}
      />,
    )
  }

  it('chips it `current`, not struck through and not dimmed', () => {
    // Observed on 7 titles: the green `current` chip on a dimmed,
    // struck-through row. Whatever else is true, a release that is the file on
    // disk is not "unavailable".
    renderCurrentRejected()

    const current = row(CURRENT_REJECTED)

    expect(within(current).getByText(RELEASE_CURRENT_LABEL)).toBeInTheDocument()
    expect(current.getAttribute('class')).not.toContain('opacity-55')
    expect(
      within(current).getByText('1080p WEB-DL · 2.1 GB').getAttribute('class'),
    ).not.toContain('line-through')
  })

  it('does not repeat upstream describing the file you already have', () => {
    renderCurrentRejected()

    expect(
      within(row(CURRENT_REJECTED)).queryByText(/Existing file meets cutoff/u),
    ).not.toBeInTheDocument()
  })

  it('still blocks the same release when it is not the current one', () => {
    render(
      <ReleasePicker
        mediaId={MOVIE_ID}
        releases={[CURRENT_REJECTED, ALTERNATIVE]}
        onGrab={jest.fn()}
      />,
    )

    const blocked = row(CURRENT_REJECTED)

    expect(blocked.getAttribute('class')).toContain('opacity-55')
    expect(
      within(blocked).getByText('Existing file meets cutoff: WEBDL-1080p'),
    ).toBeInTheDocument()
  })
})

describe('ReleasePicker — a list in which nothing is actionable says so', () => {
  it('explains at the page level when every row is refused', () => {
    // Observed post-grab: 26 disabled rows, per-row upstream text, and nothing
    // anywhere saying the list as a whole was dead.
    render(
      <ReleasePicker
        mediaId={MOVIE_ID}
        releases={[REJECTED, { ...REJECTED, guid: 'guid-rejected-2' }]}
        onGrab={jest.fn()}
      />,
    )

    expect(screen.getByText(RELEASE_ALL_BLOCKED_NOTE)).toBeInTheDocument()
  })

  it('surfaces upstream’s own reasons rather than guessing at a cause', () => {
    render(
      <ReleasePicker
        mediaId={MOVIE_ID}
        releases={[
          REJECTED,
          {
            ...REJECTED,
            guid: 'guid-rejected-2',
            rejections: ['Not an upgrade for existing episode file(s)'],
            title: 'Dune.2021.480p.DVDRip.Other',
          },
        ]}
        onGrab={jest.fn()}
      />,
    )

    const note = screen.getByText(RELEASE_ALL_BLOCKED_NOTE).closest('div')

    expect(note).not.toBeNull()
    expect(
      within(note as HTMLElement).getByText(
        'Quality DVD is not wanted in profile',
      ),
    ).toBeInTheDocument()
    expect(
      within(note as HTMLElement).getByText(
        'Not an upgrade for existing episode file(s)',
      ),
    ).toBeInTheDocument()
  })

  it('counts the current row as non-actionable — there is nothing to take', () => {
    render(
      <ReleasePicker
        currentGuid={CURRENT.guid}
        mediaId={MOVIE_ID}
        releases={[CURRENT_REJECTED, REJECTED]}
        onReplace={jest.fn()}
      />,
    )

    expect(screen.getByText(RELEASE_ALL_BLOCKED_NOTE)).toBeInTheDocument()
  })

  it('stays quiet while even one row can still be taken', () => {
    render(
      <ReleasePicker
        mediaId={MOVIE_ID}
        releases={[REJECTED, ALTERNATIVE]}
        onGrab={jest.fn()}
      />,
    )

    expect(screen.queryByText(RELEASE_ALL_BLOCKED_NOTE)).not.toBeInTheDocument()
  })

  it('claims nothing when the picker has no pick action at all', () => {
    // A read-only picker refuses nothing; it simply does not offer.
    render(<ReleasePicker mediaId={MOVIE_ID} releases={[REJECTED]} />)

    expect(screen.queryByText(RELEASE_ALL_BLOCKED_NOTE)).not.toBeInTheDocument()
  })

  it('says nothing about an empty list — that is "nothing found", not "nothing allowed"', () => {
    render(
      <ReleasePicker mediaId={MOVIE_ID} releases={[]} onGrab={jest.fn()} />,
    )

    expect(screen.getByText(RELEASE_EMPTY_NOTE)).toBeInTheDocument()
    expect(screen.queryByText(RELEASE_ALL_BLOCKED_NOTE)).not.toBeInTheDocument()
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
  it('⚠️ offers the report control on EVERY row, not just the current one', () => {
    // Reporting a bad file you have not downloaded is a valid thing to want to
    // do. Before this, the only way to flag anything but the current release
    // was the API.
    render(
      <ReleasePicker
        currentGuid={CURRENT.guid}
        mediaId={MOVIE_ID}
        releases={[CURRENT, ALTERNATIVE, REJECTED]}
        onFlag={jest.fn()}
        onReplace={jest.fn()}
      />,
    )

    for (const release of [CURRENT, ALTERNATIVE, REJECTED]) {
      expect(
        within(row(release)).getByRole('button', { name: 'Report a problem' }),
      ).toBeInTheDocument()
    }
  })

  it('still offers no grab on the current row — it is already on disk', () => {
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
      within(row(CURRENT)).queryByRole('button', {
        name: RELEASE_REPLACE_LABEL,
      }),
    ).not.toBeInTheDocument()
    expect(
      within(row(ALTERNATIVE)).getByRole('button', {
        name: RELEASE_REPLACE_LABEL,
      }),
    ).toBeInTheDocument()
  })

  it('reports a release that is not the current one, with its own guid', async () => {
    const user = userEvent.setup()
    const onFlag = jest.fn().mockResolvedValue({ badFile: FLAG })

    render(
      <ReleasePicker
        currentGuid={CURRENT.guid}
        mediaId={MOVIE_ID}
        releases={[CURRENT, ALTERNATIVE]}
        onFlag={onFlag}
        onReplace={jest.fn()}
      />,
    )

    await user.click(
      within(row(ALTERNATIVE)).getByRole('button', {
        name: 'Report a problem',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Submit report' }))

    await waitFor(() => {
      expect(onFlag).toHaveBeenCalledTimes(1)
    })
    expect(onFlag).toHaveBeenCalledWith(MOVIE_ID, {
      guid: ALTERNATIVE.guid,
      indexerId: ALTERNATIVE.indexerId,
      reason: 'Wrong audio or subtitles',
      title: ALTERNATIVE.title,
    })
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
