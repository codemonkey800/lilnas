import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { DeleteScope } from 'src/components/detail/delete-confirm'
import {
  DeleteConfirm,
  deleteConfirmCopy,
  deleteScopeQuery,
} from 'src/components/detail/delete-confirm'

const MOVIE_ID = 'tmdb:438631'
const SHOW_ID = 'tvdb:121361'
const MOVIE_TITLE = 'Salt & Ceremony'
const SHOW_TITLE = 'Harbor Watch'

const MOVIE: DeleteScope = { kind: 'movie' }
const SERIES: DeleteScope = { kind: 'series' }
const SEASON: DeleteScope = { kind: 'season', seasonNumber: 2 }
const EPISODE: DeleteScope = {
  episodeId: 4823,
  episodeNumber: 5,
  kind: 'episode',
  seasonNumber: 2,
}

function confirmButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Delete', hidden: false })
}

/** Opens the dialog for a scope and hands back the spy the confirm will call. */
async function open(
  scope: DeleteScope,
  extra: Partial<React.ComponentProps<typeof DeleteConfirm>> = {},
) {
  const user = userEvent.setup()
  const onDelete = jest.fn().mockResolvedValue({ deletedCount: 1 })

  render(
    <DeleteConfirm
      mediaId={scope.kind === 'movie' ? MOVIE_ID : SHOW_ID}
      scope={scope}
      title={scope.kind === 'movie' ? MOVIE_TITLE : SHOW_TITLE}
      onDelete={onDelete}
      {...extra}
    />,
  )

  await user.click(screen.getAllByRole('button')[0] as HTMLElement)

  return { onDelete, user }
}

describe('deleteScopeQuery', () => {
  it('scopes an episode by its Sonarr id, and nothing else', () => {
    expect(deleteScopeQuery(EPISODE)).toEqual({ episodeId: 4823 })
  })

  it('scopes a season by its number, and nothing else', () => {
    expect(deleteScopeQuery(SEASON)).toEqual({ seasonNumber: 2 })
  })

  it.each([
    ['movie', MOVIE],
    ['series', SERIES],
  ])(
    '⚠️ sends the EMPTY query for a %s, which the backend reads as "everything"',
    (_name, scope) => {
      // The widest possible request is spelled by an absence. This function
      // exists so no call site ever assembles that by hand, and so a narrower
      // scope can never widen itself by leaking an `undefined`.
      expect(deleteScopeQuery(scope)).toEqual({})
    },
  )

  it('never carries a key it was not given', () => {
    expect(Object.keys(deleteScopeQuery(SEASON))).toEqual(['seasonNumber'])
    expect(Object.keys(deleteScopeQuery(EPISODE))).toEqual(['episodeId'])
  })
})

describe('deleteConfirmCopy — the dialog names its scope', () => {
  it('a movie says it is this movie', () => {
    const copy = deleteConfirmCopy(MOVIE, { title: MOVIE_TITLE })

    expect(copy.title).toBe('Delete "Salt & Ceremony"?')
    expect(copy.description).toContain("this movie's file")
    expect(copy.description).toContain('stays in Radarr')
  })

  it('a series says it is every season', () => {
    const copy = deleteConfirmCopy(SERIES, { title: SHOW_TITLE })

    expect(copy.title).toBe('Delete "Harbor Watch"?')
    expect(copy.description).toContain('every episode of every season')
    expect(copy.description).toContain('stays in Sonarr')
  })

  it('a season names the season, and says the others survive', () => {
    const copy = deleteConfirmCopy(SEASON, { title: SHOW_TITLE })

    expect(copy.title).toBe('Delete season 2 of "Harbor Watch"?')
    expect(copy.description).toContain('every episode in season 2')
    expect(copy.description).toContain('Other seasons are left alone')
  })

  it('an episode names the episode, and says the season survives', () => {
    const copy = deleteConfirmCopy(EPISODE, { title: SHOW_TITLE })

    expect(copy.title).toBe('Delete S02E05 of "Harbor Watch"?')
    expect(copy.description).toContain('this one episode')
    expect(copy.description).toContain('rest of the season is left alone')
  })

  it('falls back to "this episode" when the numbers are unknown', () => {
    expect(
      deleteConfirmCopy(
        { episodeId: 4823, kind: 'episode' },
        { title: SHOW_TITLE },
      ).title,
    ).toBe('Delete this episode of "Harbor Watch"?')
  })

  it('every scope says it cannot be undone', () => {
    for (const scope of [MOVIE, SERIES, SEASON, EPISODE]) {
      expect(deleteConfirmCopy(scope, { title: 'X' }).description).toContain(
        "This can't be undone",
      )
    }
  })

  it('no two scopes read the same', () => {
    const sentences = [MOVIE, SERIES, SEASON, EPISODE].map(scope =>
      JSON.stringify(deleteConfirmCopy(scope, { title: 'X' })),
    )

    expect(new Set(sentences).size).toBe(4)
  })

  it('names the space it frees when the page knows it', () => {
    expect(
      deleteConfirmCopy(MOVIE, {
        freesBytes: 2.1 * 1024 ** 3,
        title: MOVIE_TITLE,
      }).description,
    ).toContain('and frees 2.1 GB')
  })
})

describe('DeleteConfirm — the trigger', () => {
  it.each([
    ['movie', 'Delete', MOVIE],
    ['series', 'Delete series', SERIES],
    ['season', 'Delete season', SEASON],
    ['episode', 'Delete episode', EPISODE],
  ])('labels a %s trigger %p', (_name, label, scope) => {
    render(
      <DeleteConfirm
        mediaId={SHOW_ID}
        scope={scope}
        title={SHOW_TITLE}
        onDelete={jest.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
  })

  it('raises no dialog on render', () => {
    render(
      <DeleteConfirm
        mediaId={MOVIE_ID}
        scope={MOVIE}
        title={MOVIE_TITLE}
        onDelete={jest.fn()}
      />,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('DeleteConfirm — the dialog', () => {
  it('names the scope in its accessible name and description', async () => {
    await open(SEASON)

    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveAccessibleName('Delete season 2 of "Harbor Watch"?')
    expect(dialog).toHaveAccessibleDescription(
      deleteConfirmCopy(SEASON, { title: SHOW_TITLE }).description,
    )
  })

  it('puts the initial focus on Cancel, not on the destructive button', async () => {
    // APG's rule for a destructive confirm: the dialog opens on the way OUT.
    await open(MOVIE)

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('cancels without deleting anything', async () => {
    const { onDelete, user } = await open(MOVIE)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Escape cancels too — the safe direction is the dismissible one', async () => {
    const { onDelete, user } = await open(MOVIE)

    await user.keyboard('{Escape}')

    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('DeleteConfirm — confirming', () => {
  it.each([
    ['an episode', EPISODE, { episodeId: 4823 }],
    ['a season', SEASON, { seasonNumber: 2 }],
    ['a series', SERIES, {}],
  ])(
    'deletes %s with exactly the query its own scope built',
    async (_name, scope, query) => {
      // The sentence the user read and the request that goes out are derived
      // from one value, so they cannot disagree.
      const { onDelete, user } = await open(scope)

      await user.click(confirmButton())

      expect(onDelete).toHaveBeenCalledTimes(1)
      expect(onDelete).toHaveBeenCalledWith(SHOW_ID, query)
    },
  )

  it('deletes a movie against the movie key', async () => {
    const { onDelete, user } = await open(MOVIE)

    await user.click(confirmButton())

    expect(onDelete).toHaveBeenCalledWith(MOVIE_ID, {})
  })

  it('closes and reports the count it was given', async () => {
    const user = userEvent.setup()
    const onDeleted = jest.fn()

    render(
      <DeleteConfirm
        mediaId={SHOW_ID}
        scope={SEASON}
        title={SHOW_TITLE}
        onDelete={jest.fn().mockResolvedValue({ deletedCount: 7 })}
        onDeleted={onDeleted}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Delete season' }))
    await user.click(confirmButton())

    expect(onDeleted).toHaveBeenCalledWith(7)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('treats deleting zero files as a success', async () => {
    const user = userEvent.setup()
    const onDeleted = jest.fn()

    render(
      <DeleteConfirm
        mediaId={MOVIE_ID}
        scope={MOVIE}
        title={MOVIE_TITLE}
        onDelete={jest.fn().mockResolvedValue({ deletedCount: 0 })}
        onDeleted={onDeleted}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(confirmButton())

    expect(onDeleted).toHaveBeenCalledWith(0)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the dialog open and says so when the delete failed', async () => {
    const user = userEvent.setup()
    const onDeleted = jest.fn()

    render(
      <DeleteConfirm
        mediaId={MOVIE_ID}
        scope={MOVIE}
        title={MOVIE_TITLE}
        onDelete={jest
          .fn()
          .mockResolvedValue({ error: 'Could not delete those files' })}
        onDeleted={onDeleted}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(confirmButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not delete those files',
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onDeleted).not.toHaveBeenCalled()
  })
})
