import '@testing-library/jest-dom'

import type { ManualImportCandidate } from '@lilnas/utils/download/types'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { ImportDialogActions } from 'src/components/detail/import-dialog'
import {
  IMPORT_BLOCKED_REASON,
  IMPORT_CANCEL_LABEL,
  IMPORT_CONFIRM_LABEL,
  IMPORT_DESCRIPTION,
  IMPORT_DIALOG_TITLE,
  IMPORT_DISCARD_KEEP_LABEL,
  IMPORT_DISCARD_LABEL,
  IMPORT_DISCARD_NOTE,
  IMPORT_DISCARD_TITLE,
  IMPORT_EMPTY_NOTE,
  IMPORT_REJECTION_NOTE,
  IMPORT_TRIGGER_LABEL,
  importCandidateSecondary,
  ImportDialog,
  importDialogTitle,
  importRejections,
} from 'src/components/detail/import-dialog'

const MOVIE_ID = 'tmdb:445571'
const SHOW_ID = 'tvdb:121361'
const MOVIE_TITLE = 'Game Night'

/**
 * The real stuck Radarr candidate, mapped to the wire shape.
 *
 * Every field is the one upstream actually reported — including the rejection,
 * which is why the download stopped: Radarr could not find the movie *in the
 * grabbed release name*, so it declined to import a file that is sitting right
 * there on disk.
 */
const GAME_NIGHT: ManualImportCandidate = {
  downloadId: 'ce427a39-be9f-4271-b193-f7067dd82c4a',
  importable: true,
  languages: ['English'],
  movieTitle: 'Game Night',
  name: 'Game.Night.2018.1080p.BluRay.x265',
  path: '/downloads/Game.Night.2018.1080p.BluRay.x265/Game.Night.2018.1080p.BluRay.x265.mp4',
  quality: { name: 'Bluray-1080p', resolution: 1080 },
  rejections: [
    'Movie [Game Night (2018)][tt2704998, 445571] was not found in the grabbed release: Game.Night.2018.1080p.BluRay.x265',
  ],
  relativePath: 'Game.Night.2018.1080p.BluRay.x265.mp4',
  size: 1674940307,
}

/** A second file in the same folder, which the server refuses outright. */
const SAMPLE: ManualImportCandidate = {
  blockedReason: 'Sample file — too small to be the feature.',
  importable: false,
  path: '/downloads/Game.Night.2018.1080p.BluRay.x265/sample.mkv',
  rejections: [],
  relativePath: 'sample.mkv',
  size: 12 * 1024 * 1024,
}

/** An episode candidate, for the `S02E05` column a movie never renders. */
const EPISODE: ManualImportCandidate = {
  episodes: [
    { episodeNumber: 5, id: 4823, seasonNumber: 2 },
    { episodeNumber: 6, id: 4824, seasonNumber: 2 },
  ],
  importable: true,
  path: '/downloads/Harbor.Watch.S02E05E06/Harbor.Watch.S02E05E06.mkv',
  quality: { name: 'WEBDL-1080p', resolution: 1080 },
  rejections: [],
  relativePath: 'Harbor.Watch.S02E05E06.mkv',
  size: 3 * 1024 ** 3,
}

/** The rejection as the dialog renders it — `formatRejection`'s doing. */
const GAME_NIGHT_REJECTION = GAME_NIGHT.rejections[0] as string

function stub(
  candidates: readonly ManualImportCandidate[],
): ImportDialogActions & {
  commit: jest.Mock
  discard: jest.Mock
  list: jest.Mock
} {
  return {
    commit: jest.fn().mockResolvedValue({ importedCount: candidates.length }),
    discard: jest.fn().mockResolvedValue({ discardedCount: 1 }),
    list: jest.fn().mockResolvedValue({ candidates: [...candidates] }),
  }
}

/** Renders, presses the trigger, and waits for the list to land. */
async function open(
  candidates: readonly ManualImportCandidate[] = [GAME_NIGHT],
  props: Partial<Parameters<typeof ImportDialog>[0]> = {},
) {
  const user = userEvent.setup()
  const actions = stub(candidates)
  const onDone = jest.fn()

  render(
    <ImportDialog
      actions={actions}
      mediaId={MOVIE_ID}
      title={MOVIE_TITLE}
      onDone={onDone}
      {...props}
    />,
  )

  await user.click(screen.getByRole('button', { name: IMPORT_TRIGGER_LABEL }))
  await waitFor(() => expect(actions.list).toHaveBeenCalled())

  return { actions, onDone, user }
}

function confirmButton(): HTMLElement {
  return screen.getByRole('button', { name: IMPORT_CONFIRM_LABEL })
}

describe('importDialogTitle', () => {
  it('names the title the mockup way', () => {
    expect(importDialogTitle(MOVIE_TITLE)).toBe('Import "Game Night"')
  })

  it('falls back to the generic heading when there is no title', () => {
    expect(importDialogTitle()).toBe(IMPORT_DIALOG_TITLE)
  })
})

describe('importCandidateSecondary', () => {
  it('reads a movie candidate as its resolved title', () => {
    expect(importCandidateSecondary(GAME_NIGHT)).toBe('Game Night')
  })

  it('reads an episode candidate as the codes it covers', () => {
    expect(importCandidateSecondary(EPISODE)).toBe('S02E05 · S02E06')
  })

  it('reads a candidate resolved to nothing as the em dash', () => {
    expect(importCandidateSecondary(SAMPLE)).toBe('—')
  })
})

describe('importRejections', () => {
  it('cleans and de-duplicates upstream words across the list', () => {
    // The `[]` artifact is `formatRejection`'s, and the same sentence on two
    // rows is one line in the note.
    expect(
      importRejections([
        {
          ...GAME_NIGHT,
          rejections: ['Existing file meets cutoff: WORKPRINT []'],
        },
        { ...SAMPLE, rejections: ['Existing file meets cutoff: WORKPRINT []'] },
      ]),
    ).toEqual(['Existing file meets cutoff: WORKPRINT'])
  })

  it('drops a rejection that was only an artifact', () => {
    expect(importRejections([{ ...SAMPLE, rejections: ['[]'] }])).toEqual([])
  })
})

describe('ImportDialog — the trigger', () => {
  it('fetches nothing while closed', () => {
    const actions = stub([GAME_NIGHT])

    render(
      <ImportDialog actions={actions} mediaId={MOVIE_ID} title={MOVIE_TITLE} />,
    )

    // ⚠️ `GET …/imports` asks upstream about live queue items. A page with one
    // of these per episode row must not ask once per row on load.
    expect(actions.list).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('asks once on open, and once only', async () => {
    const { actions } = await open()

    expect(actions.list).toHaveBeenCalledTimes(1)
    expect(actions.list).toHaveBeenCalledWith(MOVIE_ID, {
      episodeId: undefined,
      seasonNumber: undefined,
    })
  })

  it('forwards the job scope to the list call', async () => {
    const { actions } = await open([EPISODE], {
      mediaId: SHOW_ID,
      scope: { episodeId: 4823, episodeNumber: 5, seasonNumber: 2 },
    })

    // The display-only `episodeNumber` stays out of the query.
    expect(actions.list).toHaveBeenCalledWith(SHOW_ID, {
      episodeId: 4823,
      seasonNumber: 2,
    })
  })
})

describe('ImportDialog — the dialog', () => {
  it('names the title and explains itself', async () => {
    await open()

    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveAccessibleName('Import "Game Night"')
    expect(dialog).toHaveAccessibleDescription(IMPORT_DESCRIPTION)
  })

  it('puts the initial focus on Cancel', async () => {
    await open()

    expect(
      screen.getByRole('button', { name: IMPORT_CANCEL_LABEL }),
    ).toHaveFocus()
  })

  it('renders the candidate, checked, with its quality, size and title', async () => {
    await open()

    const row = screen.getByRole('checkbox', {
      name: /Game\.Night\.2018\.1080p\.BluRay\.x265\.mp4/,
    })

    expect(row).toHaveAttribute('aria-checked', 'true')
    expect(within(row).getByText('Bluray-1080p · 1.6 GB')).toBeInTheDocument()
    expect(within(row).getByText('Game Night')).toBeInTheDocument()
    expect(within(row).getByText('English')).toBeInTheDocument()
  })

  it("reports upstream's rejection, and then discounts it", async () => {
    await open()

    // Informational, never a blocker: `ManualImport` builds a fresh decision.
    expect(screen.getByText(GAME_NIGHT_REJECTION)).toBeInTheDocument()
    expect(screen.getByText(IMPORT_REJECTION_NOTE)).toBeInTheDocument()
    expect(confirmButton()).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('cancels without importing anything', async () => {
    const { actions, user } = await open()

    await user.click(screen.getByRole('button', { name: IMPORT_CANCEL_LABEL }))

    expect(actions.commit).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('ImportDialog — a blocked row', () => {
  it('renders it disabled, with the reason the server gave', async () => {
    await open([GAME_NIGHT, SAMPLE])

    const row = screen.getByRole('checkbox', { name: /sample\.mkv/ })

    expect(row).toHaveAttribute('aria-disabled', 'true')
    expect(row).toHaveAttribute('aria-checked', 'false')
    expect(row).toHaveAccessibleDescription(SAMPLE.blockedReason as string)
  })

  it('falls back to a written reason when the server gave none', async () => {
    await open([{ ...SAMPLE, blockedReason: undefined }])

    expect(screen.getByText(IMPORT_BLOCKED_REASON)).toBeInTheDocument()
  })

  it('refuses to be checked, so it can never reach the commit', async () => {
    const { actions, user } = await open([GAME_NIGHT, SAMPLE])

    await user.click(screen.getByRole('checkbox', { name: /sample\.mkv/ }))

    expect(
      screen.getByRole('checkbox', { name: /sample\.mkv/ }),
    ).toHaveAttribute('aria-checked', 'false')

    await user.click(confirmButton())

    expect(actions.commit).toHaveBeenCalledWith(MOVIE_ID, {
      episodeId: undefined,
      paths: [GAME_NIGHT.path],
      seasonNumber: undefined,
    })
  })
})

describe('ImportDialog — importing', () => {
  it('sends exactly the checked paths, plus the scope', async () => {
    const { actions, user } = await open([EPISODE, GAME_NIGHT], {
      mediaId: SHOW_ID,
      scope: { seasonNumber: 2 },
    })

    // Both start checked; unchecking one leaves one.
    await user.click(
      screen.getByRole('checkbox', {
        name: /Game\.Night\.2018\.1080p\.BluRay\.x265\.mp4/,
      }),
    )
    await user.click(confirmButton())

    expect(actions.commit).toHaveBeenCalledTimes(1)
    expect(actions.commit).toHaveBeenCalledWith(SHOW_ID, {
      episodeId: undefined,
      paths: [EPISODE.path],
      seasonNumber: 2,
    })
  })

  it('offers no import at all once nothing is checked', async () => {
    const { actions, user } = await open()

    await user.click(
      screen.getByRole('checkbox', {
        name: /Game\.Night\.2018\.1080p\.BluRay\.x265\.mp4/,
      }),
    )

    expect(confirmButton()).toHaveAttribute('aria-disabled', 'true')

    await user.click(confirmButton())

    expect(actions.commit).not.toHaveBeenCalled()
  })

  it('closes and reports the outcome on success', async () => {
    const { onDone, user } = await open()

    await user.click(confirmButton())

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(onDone).toHaveBeenCalledWith('imported')
  })

  it('treats importing zero files as a success, not an error', async () => {
    const { actions, onDone, user } = await open()

    actions.commit.mockResolvedValue({ importedCount: 0 })

    await user.click(confirmButton())

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('imported'))
  })

  it('renders an error and stays open', async () => {
    const { actions, onDone, user } = await open()

    actions.commit.mockResolvedValue({ error: 'Radarr said no.' })

    await user.click(confirmButton())

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Radarr said no.'),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('ImportDialog — discarding', () => {
  it('asks first, and discards nothing until the second press', async () => {
    const { actions, user } = await open()

    await user.click(screen.getByRole('button', { name: IMPORT_DISCARD_LABEL }))

    expect(actions.discard).not.toHaveBeenCalled()
    expect(screen.getByText(IMPORT_DISCARD_TITLE)).toBeInTheDocument()
    expect(screen.getByText(IMPORT_DISCARD_NOTE)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: IMPORT_DISCARD_LABEL }))

    expect(actions.discard).toHaveBeenCalledTimes(1)
    expect(actions.discard).toHaveBeenCalledWith(MOVIE_ID, {
      episodeId: undefined,
      seasonNumber: undefined,
    })
  })

  it('"Keep it" puts the footer back, untouched', async () => {
    const { actions, user } = await open()

    await user.click(screen.getByRole('button', { name: IMPORT_DISCARD_LABEL }))
    await user.click(
      screen.getByRole('button', { name: IMPORT_DISCARD_KEEP_LABEL }),
    )

    expect(actions.discard).not.toHaveBeenCalled()
    expect(screen.queryByText(IMPORT_DISCARD_TITLE)).not.toBeInTheDocument()
    expect(confirmButton()).toBeInTheDocument()
  })

  it('closes and reports the outcome on success', async () => {
    const { onDone, user } = await open()

    await user.click(screen.getByRole('button', { name: IMPORT_DISCARD_LABEL }))
    await user.click(screen.getByRole('button', { name: IMPORT_DISCARD_LABEL }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(onDone).toHaveBeenCalledWith('discarded')
  })

  it('renders an error and stays open', async () => {
    const { actions, onDone, user } = await open()

    actions.discard.mockResolvedValue({ error: 'The queue item is gone.' })

    await user.click(screen.getByRole('button', { name: IMPORT_DISCARD_LABEL }))
    await user.click(screen.getByRole('button', { name: IMPORT_DISCARD_LABEL }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The queue item is gone.',
      ),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('ImportDialog — an empty list', () => {
  it('says so, drops Import, and keeps Discard', async () => {
    // The queue item can still be there with no files, and discarding is the
    // only way out of it.
    await open([])

    expect(screen.getByText(IMPORT_EMPTY_NOTE)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: IMPORT_CONFIRM_LABEL }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: IMPORT_DISCARD_LABEL }),
    ).toBeInTheDocument()
  })

  it('still discards from the empty state', async () => {
    const { actions, user } = await open([])

    await user.click(screen.getByRole('button', { name: IMPORT_DISCARD_LABEL }))
    await user.click(screen.getByRole('button', { name: IMPORT_DISCARD_LABEL }))

    expect(actions.discard).toHaveBeenCalledTimes(1)
  })
})
