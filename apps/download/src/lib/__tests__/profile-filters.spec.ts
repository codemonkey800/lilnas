import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

import type { ProfileFilters } from 'src/lib/profile-filters'
import {
  clearProfileFilters,
  EMPTY_PROFILE_FILTERS,
  hasProfileFilters,
  parseProfileFilters,
  PROFILE_HREF,
  PROFILE_STATUS_ORDER,
  PROFILE_TYPE_ORDER,
  profileFilterChips,
  profileFiltersToSearch,
  profileHistoryQuery,
  profileHref,
  profileHrefForEmail,
  toggleProfileStatus,
  toggleProfileType,
} from 'src/lib/profile-filters'

function filters(overrides: Partial<ProfileFilters> = {}): ProfileFilters {
  return { ...EMPTY_PROFILE_FILTERS, ...overrides }
}

/** Every subset of `values`, as arrays in `values`' own order. */
function subsets<T>(values: readonly T[]): T[][] {
  return values.reduce<T[][]>(
    (acc, value) => [...acc, ...acc.map(subset => [...subset, value])],
    [[]],
  )
}

describe('PROFILE_STATUS_ORDER', () => {
  it('lists every status exactly once', () => {
    expect([...PROFILE_STATUS_ORDER].sort()).toEqual(
      Object.values(DownloadJobStatus).sort(),
    )
  })

  it('sits a stuck import where the import it stalled would have been', () => {
    // Lifecycle order, not alphabetical: the chip row reads as the shape of a
    // job's life, and a decision upstream is waiting on happens at the import
    // step rather than beside `cancelled`.
    const at = (status: DownloadJobStatus) =>
      PROFILE_STATUS_ORDER.indexOf(status)

    expect(at(DownloadJobStatus.NeedsAttention)).toBe(
      at(DownloadJobStatus.Importing) + 1,
    )
    expect(at(DownloadJobStatus.NeedsAttention)).toBeLessThan(
      at(DownloadJobStatus.Cleaning),
    )
  })
})

describe('parseProfileFilters', () => {
  it('reads nothing out of a bare path', () => {
    expect(parseProfileFilters({})).toEqual(EMPTY_PROFILE_FILTERS)
  })

  it('reads both facets and the subject', () => {
    expect(
      parseProfileFilters({
        status: 'failed,completed',
        type: 'movie',
        user: 'sam@lilnas.io',
      }),
    ).toEqual({
      statuses: [DownloadJobStatus.Completed, DownloadJobStatus.Failed],
      types: [DownloadType.Movie],
      user: 'sam@lilnas.io',
    })
  })

  it('accepts repeated parameters as well as comma-separated ones', () => {
    expect(parseProfileFilters({ type: ['movie', 'video'] })).toEqual(
      filters({ types: [DownloadType.Video, DownloadType.Movie] }),
    )
  })

  it('normalizes into the canonical order, whatever the URL said', () => {
    expect(parseProfileFilters({ type: 'show,video,movie' }).types).toEqual([
      DownloadType.Video,
      DownloadType.Movie,
      DownloadType.Show,
    ])
    expect(
      parseProfileFilters({ status: 'cancelled,completed,downloading' })
        .statuses,
    ).toEqual([
      DownloadJobStatus.Downloading,
      DownloadJobStatus.Completed,
      DownloadJobStatus.Cancelled,
    ])
  })

  it('drops values it does not recognize rather than rejecting the URL', () => {
    expect(
      parseProfileFilters({ status: 'queued,completed', type: 'podcast' }),
    ).toEqual(filters({ statuses: [DownloadJobStatus.Completed] }))
  })

  // `queued` is `profile.mjs`'s invention; the enum has `pending`/`requested`.
  it('does not recognize the mockup’s `queued`', () => {
    expect(parseProfileFilters({ status: 'queued' }).statuses).toEqual([])
  })

  it('reads an email verbatim rather than splitting it on commas', () => {
    // A quoted local part may legally contain a comma. Splitting one the way
    // the type/status readers do would silently truncate the address.
    expect(parseProfileFilters({ user: '"a,b"@lilnas.io' }).user).toBe(
      '"a,b"@lilnas.io',
    )
  })

  it('treats a blank user as no user at all', () => {
    expect(parseProfileFilters({ user: '   ' }).user).toBeNull()
    expect(parseProfileFilters({ user: '' }).user).toBeNull()
  })

  it('reads a URLSearchParams the same way it reads searchParams', () => {
    const params = new URLSearchParams('type=movie&status=failed&user=a@b.c')

    expect(parseProfileFilters(params)).toEqual(
      parseProfileFilters({
        status: 'failed',
        type: 'movie',
        user: 'a@b.c',
      }),
    )
  })
})

describe('profileFiltersToSearch', () => {
  it('writes nothing for an unfiltered view of your own profile', () => {
    expect(profileFiltersToSearch(EMPTY_PROFILE_FILTERS)).toBe('')
  })

  // The exhaustive round-trip proof. Every reachable filter state is
  // 3 types x 15 statuses x (no user | a user), and `parse(serialize(f))` has
  // to be `f` for all of them — that property is the only thing that makes the
  // URL safe to treat as the state rather than as a copy of it.
  it('round-trips every reachable state through the URL', () => {
    // `user` is a third, independent dimension: it is written first, read by
    // its own reader, and cannot collide with either facet's parameter. Two
    // values cover it, which keeps this at ~260k states rather than ~520k.
    const users = [null, 'sam@lilnas.io']
    // Collected rather than asserted per iteration: one `toEqual` per state
    // turns a four-second test into half a minute. A failure still names the
    // exact query string that broke.
    const failures: string[] = []
    const key = (value: ProfileFilters): string =>
      `${value.user ?? ''}|${value.types.join()}|${value.statuses.join()}`

    for (const types of subsets(PROFILE_TYPE_ORDER)) {
      for (const statuses of subsets(PROFILE_STATUS_ORDER)) {
        for (const user of users) {
          const value: ProfileFilters = { statuses, types, user }
          const search = profileFiltersToSearch(value)
          const back = parseProfileFilters(new URLSearchParams(search))

          if (key(back) !== key(value)) {
            failures.push(`${search} -> ${key(back)} (want ${key(value)})`)
          }
        }
      }
    }

    expect(failures).toEqual([])
  })

  it('carries the subject forward, so a chip press stays on the same profile', () => {
    const search = profileFiltersToSearch(
      filters({ types: [DownloadType.Movie], user: 'sam@lilnas.io' }),
    )

    expect(new URLSearchParams(search).get('user')).toBe('sam@lilnas.io')
  })
})

describe('profileHref', () => {
  it('drops the question mark when there is nothing to ask', () => {
    expect(profileHref(EMPTY_PROFILE_FILTERS)).toBe(PROFILE_HREF)
  })

  it('spells somebody else’s profile as a query, not a path segment', () => {
    // A path segment would promise a resource that can 404. A profile is a
    // computed view and an unknown email is an empty one.
    expect(profileHrefForEmail('sam@lilnas.io')).toBe(
      `${PROFILE_HREF}?user=sam%40lilnas.io`,
    )
  })

  it('survives the round trip from the href it just built', () => {
    const href = profileHrefForEmail('sam@lilnas.io')

    expect(
      parseProfileFilters(new URLSearchParams(href.split('?')[1])).user,
    ).toBe('sam@lilnas.io')
  })
})

describe('profileHistoryQuery', () => {
  // `GET /download/history` with no requester is *everyone's* history, so the
  // one thing this must never do is leave it off.
  it('always names the requester, even for your own profile', () => {
    expect(
      profileHistoryQuery(EMPTY_PROFILE_FILTERS, 'jeremy@lilnas.io'),
    ).toEqual({
      cursor: undefined,
      requester: 'jeremy@lilnas.io',
      status: undefined,
      type: undefined,
    })
  })

  it('sends the requester it was given, not the URL’s `user`', () => {
    const query = profileHistoryQuery(
      filters({ user: 'sam@lilnas.io' }),
      'sam@lilnas.io',
      'cursor-1',
    )

    expect(query.requester).toBe('sam@lilnas.io')
    expect(query.cursor).toBe('cursor-1')
  })

  it('passes both facets through, and omits an empty one entirely', () => {
    expect(
      profileHistoryQuery(
        filters({
          statuses: [DownloadJobStatus.Failed],
          types: [DownloadType.Movie, DownloadType.Show],
        }),
        'jeremy@lilnas.io',
      ),
    ).toMatchObject({
      status: [DownloadJobStatus.Failed],
      type: [DownloadType.Movie, DownloadType.Show],
    })
  })
})

describe('toggleProfileType / toggleProfileStatus', () => {
  it('adds a second value rather than replacing the first', () => {
    const one = toggleProfileType(EMPTY_PROFILE_FILTERS, DownloadType.Movie)
    const two = toggleProfileType(one, DownloadType.Video)

    expect(two.types).toEqual([DownloadType.Video, DownloadType.Movie])
  })

  it('normalizes the order, so two clicks in either order are one filter', () => {
    const a = toggleProfileType(
      toggleProfileType(EMPTY_PROFILE_FILTERS, DownloadType.Show),
      DownloadType.Video,
    )
    const b = toggleProfileType(
      toggleProfileType(EMPTY_PROFILE_FILTERS, DownloadType.Video),
      DownloadType.Show,
    )

    expect(profileFiltersToSearch(a)).toBe(profileFiltersToSearch(b))
  })

  it('is its own inverse', () => {
    const on = toggleProfileStatus(
      EMPTY_PROFILE_FILTERS,
      DownloadJobStatus.Failed,
    )

    expect(toggleProfileStatus(on, DownloadJobStatus.Failed)).toEqual(
      EMPTY_PROFILE_FILTERS,
    )
  })

  it('never touches the subject of the page', () => {
    const scoped = filters({ user: 'sam@lilnas.io' })

    expect(toggleProfileType(scoped, DownloadType.Movie).user).toBe(
      'sam@lilnas.io',
    )
    expect(toggleProfileStatus(scoped, DownloadJobStatus.Failed).user).toBe(
      'sam@lilnas.io',
    )
  })
})

describe('hasProfileFilters / clearProfileFilters', () => {
  it('does not count the subject as a filter', () => {
    // An empty profile reached through `?user=` is an empty profile, not a
    // filter that matched nothing.
    expect(hasProfileFilters(filters({ user: 'sam@lilnas.io' }))).toBe(false)
  })

  it('counts either facet', () => {
    expect(hasProfileFilters(filters({ types: [DownloadType.Movie] }))).toBe(
      true,
    )
    expect(
      hasProfileFilters(filters({ statuses: [DownloadJobStatus.Failed] })),
    ).toBe(true)
  })

  it('clears both facets and stays on the same person', () => {
    expect(
      clearProfileFilters(
        filters({
          statuses: [DownloadJobStatus.Failed],
          types: [DownloadType.Movie],
          user: 'sam@lilnas.io',
        }),
      ),
    ).toEqual(filters({ user: 'sam@lilnas.io' }))
  })
})

describe('profileFilterChips', () => {
  it('lists types before statuses, each removable on its own', () => {
    const chips = profileFilterChips(
      filters({
        statuses: [DownloadJobStatus.Completed],
        types: [DownloadType.Video, DownloadType.Show],
      }),
    )

    expect(chips.map(chip => chip.label)).toEqual([
      'video',
      'show',
      'completed',
    ])
    expect(chips.map(chip => chip.removeLabel)).toEqual([
      'Remove video filter',
      'Remove show filter',
      'Remove completed filter',
    ])
  })

  it('removes exactly the one chip and leaves the rest applied', () => {
    const applied = filters({
      statuses: [DownloadJobStatus.Completed],
      types: [DownloadType.Video, DownloadType.Show],
    })
    const chips = profileFilterChips(applied)

    expect(chips[0]?.next).toEqual({
      ...applied,
      types: [DownloadType.Show],
    })
  })

  it('has nothing to show when nothing is applied', () => {
    expect(profileFilterChips(filters({ user: 'sam@lilnas.io' }))).toEqual([])
  })
})
