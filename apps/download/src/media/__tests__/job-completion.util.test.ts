import type { MovieFileResource } from '@lilnas/media/radarr'
import type { EpisodeFileResource, EpisodeResource } from '@lilnas/media/sonarr'

import {
  type CompletionEpisode,
  type CompletionFile,
  didJobComplete,
} from 'src/media/job-completion.util'

const CREATED_AT = new Date('2026-09-17T12:00:00.000Z')

const BEFORE = '2026-09-17T11:59:59.000Z'
const AFTER = '2026-09-17T12:00:06.000Z'
const LATER = '2026-09-17T12:30:00.000Z'

// One file per episode, named after the episode it belongs to, so a test
// only has to say which ones landed late.
function file(id: number, dateAdded?: string, seasonNumber?: number) {
  return { dateAdded, id, seasonNumber } satisfies CompletionFile
}

function episode(id: number, seasonNumber: number, episodeFileId?: number) {
  return { episodeFileId, id, seasonNumber } satisfies CompletionEpisode
}

describe('didJobComplete', () => {
  // The input types are structural so both call sites - the poller and the
  // boot sweep - can pass the generated upstream resources straight in. This
  // asserts that at compile time (every field on all three is optional, which
  // is why `CompletionEpisode.id` is optional too); the runtime expectations
  // are incidental.
  it('accepts the generated Radarr/Sonarr resources with no conversion', () => {
    const movieFiles: MovieFileResource[] = [{ dateAdded: AFTER, id: 1 }]
    const episodeFiles: EpisodeFileResource[] = [
      { dateAdded: AFTER, id: 301, seasonNumber: 3 },
    ]
    const episodes: EpisodeResource[] = [
      { episodeFileId: 301, id: 2, seasonNumber: 3 },
    ]

    expect(didJobComplete({ createdAt: CREATED_AT, files: movieFiles })).toBe(
      true,
    )

    expect(
      didJobComplete({
        createdAt: CREATED_AT,
        episodes,
        files: episodeFiles,
        scope: { seasonNumber: 3 },
      }),
    ).toBe(true)
  })

  describe('a movie', () => {
    it('completes on a file added after the job was created', () => {
      expect(
        didJobComplete({ createdAt: CREATED_AT, files: [file(1, AFTER)] }),
      ).toBe(true)
    })

    // The whole point of the check: a file that predates the job is the
    // library's existing copy, not something this job downloaded.
    it('does not complete on a file older than the job', () => {
      expect(
        didJobComplete({ createdAt: CREATED_AT, files: [file(1, BEFORE)] }),
      ).toBe(false)
    })

    it('completes when any one of several files is new', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          files: [file(1, BEFORE), file(2, LATER)],
        }),
      ).toBe(true)
    })

    it('does not complete with no files at all', () => {
      expect(didJobComplete({ createdAt: CREATED_AT, files: [] })).toBe(false)
    })

    // Documented in `isAddedAfter`: the comparison is strictly `>`, so a
    // file stamped at the job's own creation instant was already there.
    it('treats a dateAdded equal to createdAt as not newer', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          files: [file(1, CREATED_AT.toISOString())],
        }),
      ).toBe(false)
    })

    it('does not complete on a file with no dateAdded', () => {
      expect(didJobComplete({ createdAt: CREATED_AT, files: [file(1)] })).toBe(
        false,
      )
    })

    it('does not complete on an empty dateAdded', () => {
      expect(
        didJobComplete({ createdAt: CREATED_AT, files: [file(1, '   ')] }),
      ).toBe(false)
    })

    it('does not complete on an unparseable dateAdded', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          files: [file(1, 'not a date')],
        }),
      ).toBe(false)
    })

    // Total, not throwing: an unusable `createdAt` is simply no evidence.
    it('does not complete when createdAt is an Invalid Date', () => {
      expect(
        didJobComplete({
          createdAt: new Date('nonsense'),
          files: [file(1, AFTER)],
        }),
      ).toBe(false)
    })

    // A movie needs no id indirection - there is no episode pointing at the
    // file - so a file the upstream returned without an id still counts.
    it('completes on a new file that has no id', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          files: [{ dateAdded: AFTER }],
        }),
      ).toBe(true)
    })
  })

  describe('an episode scope', () => {
    const episodes = [
      episode(4412, 3, 991),
      episode(4413, 3, 992),
      episode(4414, 3),
    ]

    it('completes when that episode’s own file is new', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [file(991, BEFORE, 3), file(992, AFTER, 3)],
          scope: { episodeId: 4413, seasonNumber: 3 },
        }),
      ).toBe(true)
    })

    // A sibling episode landing says nothing about the one that was asked
    // for - the episode -> file link is what resolves this, not the season.
    it('does not complete when only a sibling episode’s file is new', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [file(991, BEFORE, 3), file(992, AFTER, 3)],
          scope: { episodeId: 4412, seasonNumber: 3 },
        }),
      ).toBe(false)
    })

    it('does not complete for an episode id that matches nothing', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [file(991, AFTER, 3), file(992, AFTER, 3)],
          scope: { episodeId: 9999 },
        }),
      ).toBe(false)
    })

    it('does not complete for an episode with Sonarr’s episodeFileId of 0', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes: [episode(4412, 3, 0)],
          files: [file(991, AFTER, 3)],
          scope: { episodeId: 4412 },
        }),
      ).toBe(false)
    })

    it('does not complete for an episode with no episodeFileId at all', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [file(991, AFTER, 3)],
          scope: { episodeId: 4414 },
        }),
      ).toBe(false)
    })

    it('does not complete when the episodeFileId points at a missing file', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [file(991, AFTER, 3)],
          scope: { episodeId: 4413, seasonNumber: 3 },
        }),
      ).toBe(false)
    })

    it('does not complete with no episodes supplied', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          files: [file(991, AFTER, 3)],
          scope: { episodeId: 4412 },
        }),
      ).toBe(false)
    })

    // `id` is optional so Sonarr's `EpisodeResource` needs no conversion at
    // the call site - which means an id-less episode is a shape that can
    // actually arrive, and it must never be matched by an episode scope.
    it('never matches an episode that arrived without an id', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes: [{ episodeFileId: 991, seasonNumber: 3 }],
          files: [file(991, AFTER, 3)],
          scope: { episodeId: 4412, seasonNumber: 3 },
        }),
      ).toBe(false)
    })
  })

  describe('a season scope', () => {
    const episodes = [
      episode(1, 1, 101),
      episode(2, 3, 301),
      episode(3, 3, 302),
    ]

    const scope = { seasonNumber: 3 }

    it('completes when every episode of the season has a new file', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [
            file(101, BEFORE, 1),
            file(301, AFTER, 3),
            file(302, LATER, 3),
          ],
          scope,
        }),
      ).toBe(true)
    })

    // A half-imported season is still downloading; completing here would
    // strand the rest of it.
    it('does not complete on a partially imported season', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [file(301, AFTER, 3), file(302, BEFORE, 3)],
          scope,
        }),
      ).toBe(false)
    })

    // Unsatisfiable, not ignorable: an episode we cannot identify might be
    // the one still downloading, so it blocks the scope.
    it('does not complete when an episode of the season has no id', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes: [{ episodeFileId: 301, seasonNumber: 3 }],
          files: [file(301, AFTER, 3)],
          scope,
        }),
      ).toBe(false)
    })

    it('lets one id-less episode block an otherwise satisfied season', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes: [...episodes, { episodeFileId: 303, seasonNumber: 3 }],
          files: [
            file(301, AFTER, 3),
            file(302, AFTER, 3),
            file(303, AFTER, 3),
          ],
          scope,
        }),
      ).toBe(false)
    })

    it('does not complete when one episode of the season has no file', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes: [...episodes, episode(4, 3)],
          files: [file(301, AFTER, 3), file(302, AFTER, 3)],
          scope,
        }),
      ).toBe(false)
    })

    // Nothing to satisfy is not success - it means the episode list never
    // resolved, which is no evidence rather than proof of completion.
    it('does not complete when no episode belongs to that season', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes: [episode(1, 1, 101)],
          files: [file(101, AFTER, 1)],
          scope,
        }),
      ).toBe(false)
    })

    it('does not complete with an empty episode list', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes: [],
          files: [file(301, AFTER, 3)],
          scope,
        }),
      ).toBe(false)
    })

    // Season 0 is specials: a truthiness check would widen this to the whole
    // series and demand every other season had landed too.
    it('treats season 0 as a real scope, not as "the whole series"', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes: [episode(1, 0, 1), episode(2, 1, 2)],
          files: [file(1, AFTER, 0), file(2, BEFORE, 1)],
          scope: { seasonNumber: 0 },
        }),
      ).toBe(true)
    })
  })

  describe('a series scope', () => {
    const episodes = [episode(1, 1, 101), episode(2, 2, 201)]

    it('completes when every episode of the series has a new file', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [file(101, AFTER, 1), file(201, LATER, 2)],
          scope: {},
        }),
      ).toBe(true)
    })

    it('does not complete while one episode is still missing its file', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [file(101, AFTER, 1), file(201, BEFORE, 2)],
          scope: {},
        }),
      ).toBe(false)
    })

    it('does not complete with an empty episode list', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes: [],
          files: [file(101, AFTER, 1)],
          scope: {},
        }),
      ).toBe(false)
    })

    // `episodeNumber` is display-only, so a scope carrying just that one is
    // still a whole-series scope.
    it('treats a scope with only episodeNumber as the whole series', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [file(101, AFTER, 1), file(201, AFTER, 2)],
          scope: { episodeNumber: 5 },
        }),
      ).toBe(true)
    })

    it('does not complete with no files at all', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [],
          scope: {},
        }),
      ).toBe(false)
    })
  })
})
