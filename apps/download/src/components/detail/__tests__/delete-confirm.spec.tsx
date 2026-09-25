import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type {
  DeleteScope,
  MediaFilesScope,
} from 'src/components/detail/delete-confirm'
import {
  DeleteConfirm,
  deleteConfirmCopy,
  deleteScopeQuery,
} from 'src/components/detail/delete-confirm'
import type { DeleteCascade } from 'src/components/detail/show-state'

const MOVIE_ID = 'tmdb:438631'
const SHOW_ID = 'tvdb:121361'
const VIDEO_ID = 'video:V1StGXR8_Z5'
const VIDEO_JOB_ID = 'job_7'
const MOVIE_TITLE = 'Salt & Ceremony'
const SHOW_TITLE = 'Harbor Watch'
const VIDEO_TITLE = 'Sourdough starter, day one to seven'

// ⚠️ Typed `MediaFilesScope`, not `DeleteScope`. These four are the ones
// `deleteScopeQuery` accepts, and saying so here is what lets the tests below
// call it directly — a `DeleteScope`-typed constant no longer would.
const MOVIE: MediaFilesScope = { kind: 'movie' }
const SERIES: MediaFilesScope = { kind: 'series' }
const SEASON: MediaFilesScope = { kind: 'season', seasonNumber: 2 }
const EPISODE: MediaFilesScope = {
  episodeId: 4823,
  episodeNumber: 5,
  kind: 'episode',
  seasonNumber: 2,
}

/** The fifth scope, which deletes a job rather than a file. */
const VIDEO: DeleteScope = { jobId: VIDEO_JOB_ID, kind: 'video' }

/**
 * The same two show scopes, with a cascade prediction on them.
 *
 * Built by a function rather than spread from the constants above: those are
 * typed as the whole union, and spreading a union is not the same object the
 * component would be handed.
 */
function seasonScope(cascadesTo?: DeleteCascade): MediaFilesScope {
  return { cascadesTo, kind: 'season', seasonNumber: 2 }
}

function episodeScope(cascadesTo?: DeleteCascade): MediaFilesScope {
  return {
    cascadesTo,
    episodeId: 4823,
    episodeNumber: 5,
    kind: 'episode',
    seasonNumber: 2,
  }
}

/**
 * The two sentences as they read with no cascade, spelled out in full.
 *
 * ⚠️ Compared with `toBe`, not `toContain`. The cascade clause is inserted
 * into these, and "byte-identical when there is nothing to warn about" is the
 * guarantee that keeps a prediction from rewriting the base copy.
 */
const EPISODE_PLAIN =
  "Removes the file for this one episode from the library. The rest of the season is left alone. This can't be undone."

const SEASON_PLAIN =
  "Removes the file for every episode in season 2 from the library. Other seasons are left alone. This can't be undone."

const EVERY_SCOPE: readonly DeleteScope[] = [
  MOVIE,
  SERIES,
  SEASON,
  EPISODE,
  VIDEO,
]

/** The page each scope belongs to, so no test has to restate the pairing. */
function mediaIdFor(scope: DeleteScope): string {
  switch (scope.kind) {
    case 'movie':
      return MOVIE_ID
    case 'video':
      return VIDEO_ID
    default:
      return SHOW_ID
  }
}

function titleFor(scope: DeleteScope): string {
  switch (scope.kind) {
    case 'movie':
      return MOVIE_TITLE
    case 'video':
      return VIDEO_TITLE
    default:
      return SHOW_TITLE
  }
}

function confirmButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Delete', hidden: false })
}

/**
 * Opens the dialog for a scope and hands back both spies.
 *
 * Both are always wired, so which one a scope reaches for is the component's
 * decision rather than this render's — the same reason `renderList` in
 * `attempt-list.spec.tsx` wires every attempt control at once.
 */
async function open(
  scope: DeleteScope,
  extra: Partial<React.ComponentProps<typeof DeleteConfirm>> = {},
) {
  const user = userEvent.setup()
  const onDelete = jest.fn().mockResolvedValue({ deletedCount: 1 })
  const onDeleteVideo = jest
    .fn()
    .mockResolvedValue({ job: { id: VIDEO_JOB_ID } })

  render(
    <DeleteConfirm
      mediaId={mediaIdFor(scope)}
      scope={scope}
      title={titleFor(scope)}
      onDelete={onDelete}
      onDeleteVideo={onDeleteVideo}
      {...extra}
    />,
  )

  await user.click(screen.getAllByRole('button')[0] as HTMLElement)

  return { onDelete, onDeleteVideo, user }
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

  /**
   * ⚠️ The prediction is copy, and copy only. A client that guessed `'series'`
   * from a stale seasons payload must not be able to turn one episode's delete
   * into a series removal - the backend decides the cascade from Sonarr's own
   * episodes and queue, and it can only do that if this never travels.
   */
  it('⚠️ never puts cascadesTo on the wire', () => {
    expect(deleteScopeQuery(seasonScope('series'))).toEqual({ seasonNumber: 2 })
    expect(deleteScopeQuery(episodeScope('series'))).toEqual({
      episodeId: 4823,
    })
    expect(Object.keys(deleteScopeQuery(episodeScope('season')))).toEqual([
      'episodeId',
    ])
  })

  /**
   * ⚠️ Asserted at the type level because there is no honest runtime answer.
   * `DELETE /download/media/:id/files` refuses a `video:` key outright, and the
   * value this would otherwise return — the empty query — is the *widest*
   * request there is. Widening the parameter back to `DeleteScope` turns the
   * `@ts-expect-error` into an unused directive, which is itself a build error.
   */
  it('rejects a video scope at the type level', () => {
    // @ts-expect-error - a video is deleted by job id, never by a files query.
    const invalid = () => deleteScopeQuery(VIDEO)

    expect(invalid).toBeTruthy()
  })
})

describe('deleteConfirmCopy — the dialog names its scope', () => {
  it('a movie says it is this movie', () => {
    const copy = deleteConfirmCopy(MOVIE, { title: MOVIE_TITLE })

    expect(copy.title).toBe('Delete "Salt & Ceremony"?')
    expect(copy.description).toContain("this movie's file")
    expect(copy.description).toContain('removes the movie from Radarr')
    expect(copy.description).toContain('requested again')
    expect(copy.description).not.toContain('stays in')
  })

  it('a series says it is every season', () => {
    const copy = deleteConfirmCopy(SERIES, { title: SHOW_TITLE })

    expect(copy.title).toBe('Delete "Harbor Watch"?')
    expect(copy.description).toContain('every episode of every season')
    expect(copy.description).toContain('removes the series from Sonarr')
    expect(copy.description).toContain('requested again')
    expect(copy.description).not.toContain('stays in')
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

  it('a video says it is the download, and that the link survives', () => {
    const copy = deleteConfirmCopy(VIDEO, { title: VIDEO_TITLE })

    expect(copy.title).toBe(`Delete "${VIDEO_TITLE}"?`)
    expect(copy.description).toContain("this video's downloaded file")
    expect(copy.description).toContain('The source link stays on this page')
  })

  /**
   * ⚠️ The one thing the `video` scope must not inherit. `deleteVideoJob`
   * removes objects a yt-dlp download produced; nothing of a video was ever in
   * `/storage/media-library` and no arr ever knew about it, so the movie and
   * series sentences would both be claims about a file that does not exist.
   */
  it('never tells a video it is leaving a library it was never in', () => {
    const { description } = deleteConfirmCopy(VIDEO, { title: VIDEO_TITLE })

    expect(description).not.toMatch(/library/i)
    expect(description).not.toMatch(/radarr|sonarr|emby/i)
  })

  it('every scope says it cannot be undone', () => {
    for (const scope of EVERY_SCOPE) {
      expect(deleteConfirmCopy(scope, { title: 'X' }).description).toContain(
        "This can't be undone",
      )
    }
  })

  it('no two scopes read the same', () => {
    const sentences = EVERY_SCOPE.map(scope =>
      JSON.stringify(deleteConfirmCopy(scope, { title: 'X' })),
    )

    expect(new Set(sentences).size).toBe(EVERY_SCOPE.length)
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

describe('deleteConfirmCopy — the cascade warning', () => {
  const SEASON_WARNING =
    "It's the last downloaded episode of the season, so the season is unmonitored too."

  const SERIES_WARNING_FROM_EPISODE =
    "It's the last downloaded episode of the series, so the series is removed from Sonarr."

  const SERIES_WARNING_FROM_SEASON =
    "It's the last downloaded season of the series, so the series is removed from Sonarr."

  it.each([['absent', undefined], ['none', 'none'] as const])(
    'leaves the episode sentence untouched when the cascade is %s',
    (_name, cascadesTo) => {
      expect(
        deleteConfirmCopy(episodeScope(cascadesTo), { title: SHOW_TITLE })
          .description,
      ).toBe(EPISODE_PLAIN)
    },
  )

  it.each([['absent', undefined], ['none', 'none'] as const])(
    'leaves the season sentence untouched when the cascade is %s',
    (_name, cascadesTo) => {
      expect(
        deleteConfirmCopy(seasonScope(cascadesTo), { title: SHOW_TITLE })
          .description,
      ).toBe(SEASON_PLAIN)
    },
  )

  it('warns an episode delete will unmonitor the season', () => {
    expect(
      deleteConfirmCopy(episodeScope('season'), { title: SHOW_TITLE })
        .description,
    ).toBe(
      `Removes the file for this one episode from the library. ${SEASON_WARNING} This can't be undone.`,
    )
  })

  it('warns an episode delete will remove the series from Sonarr', () => {
    expect(
      deleteConfirmCopy(episodeScope('series'), { title: SHOW_TITLE })
        .description,
    ).toContain(SERIES_WARNING_FROM_EPISODE)
  })

  // The whole point of the swap: a dialog that says the rest of the season
  // survives and then takes the series is worse than one that says neither.
  it.each([
    ['season', 'The rest of the season is left alone'],
    ['series', 'The rest of the season is left alone'],
  ] as const)(
    '⚠️ withdraws the episode reassurance for a %s cascade rather than contradicting it',
    (cascadesTo, reassurance) => {
      expect(
        deleteConfirmCopy(episodeScope(cascadesTo), { title: SHOW_TITLE })
          .description,
      ).not.toContain(reassurance)
    },
  )

  it('⚠️ withdraws the season reassurance when the series goes', () => {
    expect(
      deleteConfirmCopy(seasonScope('series'), { title: SHOW_TITLE })
        .description,
    ).not.toContain('Other seasons are left alone')
  })

  it('warns a season delete will remove the series from Sonarr, in its own words', () => {
    const { description } = deleteConfirmCopy(seasonScope('series'), {
      title: SHOW_TITLE,
    })

    expect(description).toContain(SERIES_WARNING_FROM_SEASON)
    // The season scope never claims to be an episode.
    expect(description).not.toContain(SERIES_WARNING_FROM_EPISODE)
  })

  it('⚠️ ignores a "season" cascade on a season scope, which is already taking it', () => {
    expect(
      deleteConfirmCopy(seasonScope('season'), { title: SHOW_TITLE })
        .description,
    ).toBe(SEASON_PLAIN)
  })

  it('⚠️ keeps "This can\'t be undone" last, so the warning never trails it', () => {
    for (const cascade of ['season', 'series'] as const) {
      expect(
        deleteConfirmCopy(episodeScope(cascade), { title: SHOW_TITLE })
          .description,
      ).toMatch(/so the (season|series) is [^.]+\. This can't be undone\.$/)
    }
  })

  it('still names the space it frees, before the warning', () => {
    expect(
      deleteConfirmCopy(seasonScope('series'), {
        freesBytes: 2.1 * 1024 ** 3,
        title: SHOW_TITLE,
      }).description,
    ).toContain(
      `from the library and frees 2.1 GB. ${SERIES_WARNING_FROM_SEASON}`,
    )
  })
})

describe('DeleteConfirm — the trigger', () => {
  it.each([
    ['movie', 'Delete', MOVIE],
    ['series', 'Delete series', SERIES],
    ['season', 'Delete season', SEASON],
    ['episode', 'Delete episode', EPISODE],
    // `video-detail.pug:159` — the bare word, beside `Save to device`.
    ['video', 'Delete', VIDEO],
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
    const { onDelete, onDeleteVideo, user } = await open(MOVIE)

    await user.click(confirmButton())

    expect(onDelete).toHaveBeenCalledWith(MOVIE_ID, {})
    expect(onDeleteVideo).not.toHaveBeenCalled()
  })

  /**
   * ⚠️ The job id, alone, and through the *other* action. A video's delete is
   * `DELETE /download/videos/:jobId`; the files route this dialog's other four
   * scopes use refuses a `video:` key, so sending `mediaId` there would be a
   * request the backend is right to reject.
   */
  it('deletes a video by job id, never by the media key', async () => {
    const { onDelete, onDeleteVideo, user } = await open(VIDEO)

    await user.click(confirmButton())

    expect(onDeleteVideo).toHaveBeenCalledTimes(1)
    expect(onDeleteVideo).toHaveBeenCalledWith(VIDEO_JOB_ID)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('reports no count for a video, which deletes a job rather than files', async () => {
    const user = userEvent.setup()
    const onDeleted = jest.fn()

    render(
      <DeleteConfirm
        mediaId={VIDEO_ID}
        scope={VIDEO}
        title={VIDEO_TITLE}
        onDeleted={onDeleted}
        onDeleteVideo={jest
          .fn()
          .mockResolvedValue({ job: { id: VIDEO_JOB_ID } })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(confirmButton())

    // `DeleteVideoJobResult` carries a job, not a file count — and `null` says
    // "nothing to report" rather than inventing a zero.
    expect(onDeleted).toHaveBeenCalledWith(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps a failed video delete on screen, the same as a failed file one', async () => {
    const user = userEvent.setup()

    render(
      <DeleteConfirm
        mediaId={VIDEO_ID}
        scope={VIDEO}
        title={VIDEO_TITLE}
        onDeleteVideo={jest.fn().mockResolvedValue({
          error: 'Could not delete that video — try again',
        })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(confirmButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not delete that video — try again',
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('does nothing for a video scope the page wired no video action for', async () => {
    const user = userEvent.setup()
    const onDelete = jest.fn()

    render(
      <DeleteConfirm
        mediaId={VIDEO_ID}
        scope={VIDEO}
        title={VIDEO_TITLE}
        onDelete={onDelete}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(confirmButton())

    // The file action is never the fallback: it is a different endpoint that
    // would delete something else entirely, or nothing at all.
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
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

/**
 * `Modal` owns the trap and `modal.spec.tsx` proves it in isolation. What is
 * asserted here is the *wiring* — that this call site actually reaches the
 * behaviour, since every part of it is opt-in from `DeleteConfirm`'s side and
 * a dropped `initialFocusRef` or a stray `dismissible={false}` would silently
 * strand the highest-stakes dialog in the app.
 */
describe('DeleteConfirm — focus containment', () => {
  /**
   * Renders closed, captures the trigger, then opens.
   *
   * The capture has to happen first: opening marks everything outside the
   * scrim `aria-hidden`, and Testing Library's role queries skip hidden
   * subtrees, so the trigger becomes unaddressable by role the moment the
   * dialog is up. That is the trap working, and it is asserted below.
   */
  async function raise(scope: DeleteScope = MOVIE) {
    const user = userEvent.setup()

    render(
      <DeleteConfirm
        mediaId={mediaIdFor(scope)}
        scope={scope}
        title={titleFor(scope)}
        onDelete={jest.fn().mockResolvedValue({ deletedCount: 1 })}
        onDeleteVideo={jest
          .fn()
          .mockResolvedValue({ job: { id: VIDEO_JOB_ID } })}
      />,
    )

    const trigger = screen.getAllByRole('button')[0] as HTMLElement

    await user.click(trigger)

    return { trigger, user }
  }

  function cancel(): HTMLElement {
    return screen.getByRole('button', { name: 'Cancel' })
  }

  it('takes the page behind out of the tab order and out of the a11y tree', async () => {
    const { trigger } = await raise()

    // Asserted on an ancestor rather than on the button: `inert` is applied to
    // each level's *siblings* on the walk up to the root, so what gets marked
    // is the subtree containing the trigger, not the trigger itself. Both
    // attributes travel down to it either way.
    const shut = trigger.closest('[inert]')

    expect(shut).not.toBeNull()
    expect(shut).toHaveAttribute('aria-hidden', 'true')
    // Only the dialog's own two buttons are reachable at all.
    expect(
      screen.getAllByRole('button').map(entry => entry.textContent),
    ).toEqual(['Cancel', 'Delete'])
  })

  it('cycles Tab between Cancel and Delete without ever leaving', async () => {
    const { user } = await raise()

    expect(cancel()).toHaveFocus()

    await user.tab()
    expect(confirmButton()).toHaveFocus()

    // The wrap is the trap: off the end of the last control, back to the
    // first, rather than out onto the page underneath.
    await user.tab()
    expect(cancel()).toHaveFocus()
  })

  it('cycles Shift+Tab the other way, wrapping off the start', async () => {
    const { user } = await raise()

    await user.tab({ shift: true })
    expect(confirmButton()).toHaveFocus()

    await user.tab({ shift: true })
    expect(cancel()).toHaveFocus()
  })

  it('hands focus back to the trigger on Escape', async () => {
    const { trigger, user } = await raise()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('hands focus back to the trigger on Cancel too', async () => {
    const { trigger, user } = await raise()

    await user.click(cancel())

    expect(trigger).toHaveFocus()
  })
})
