import type { MovieFileResource } from '@lilnas/media/radarr'
import type { EpisodeFileResource, EpisodeResource } from '@lilnas/media/sonarr'

import {
  type CompletionEpisode,
  type CompletionFile,
  type CompletionImport,
  completionImports,
  didJobComplete,
  hasFileAddedAfter,
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

/** The download the job grabbed, and one it never did (an RSS grab). */
const OWN = 'dl-own'
const RSS = 'dl-rss'

const LINKS = [{ downloadId: OWN }]

function imported(
  downloadId: string,
  fields: Omit<CompletionImport, 'downloadId'> = {},
): CompletionImport {
  return { date: AFTER, downloadId, ...fields }
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

    // The attempt landed what it could; how much of the season is on disk
    // is media state's to say, not this job's.
    it('completes a season with three old files and seven new ones', () => {
      const tenEpisodes = Array.from({ length: 10 }, (_, index) =>
        episode(index + 1, 3, 300 + index + 1),
      )
      const files = tenEpisodes.map((_, index) =>
        file(300 + index + 1, index < 3 ? BEFORE : AFTER, 3),
      )

      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes: tenEpisodes,
          files,
          scope,
        }),
      ).toBe(true)
    })

    // Unaired episodes and ones no indexer had never get a file, and must
    // not hold the attempt open.
    it('completes when some episodes of the season never got a file', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes: [...episodes, episode(4, 3), episode(5, 3, 0)],
          files: [file(301, AFTER, 3)],
          scope,
        }),
      ).toBe(true)
    })

    // Evidence is still required: the library's old copies are not this
    // attempt's result.
    it('does not complete when every file in the season is older than the job', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [file(301, BEFORE, 3), file(302, BEFORE, 3)],
          scope,
        }),
      ).toBe(false)
    })

    it('does not complete when only another season got a new file', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [
            file(101, AFTER, 1),
            file(301, BEFORE, 3),
            file(302, BEFORE, 3),
          ],
          scope,
        }),
      ).toBe(false)
    })

    // Season membership comes from the episode, and the file it points at is
    // the evidence - neither needs the episode's own id.
    it('counts a new file pointed at by an episode that has no id', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes: [{ episodeFileId: 301, seasonNumber: 3 }],
          files: [file(301, AFTER, 3)],
          scope,
        }),
      ).toBe(true)
    })

    // No episode in the season means the episode list never resolved, which
    // is no evidence rather than proof of completion.
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

    // Season 0 is specials: a falsiness check would widen this to the whole
    // series, where season 1's new file would complete it.
    it('treats season 0 as a real scope, not as "the whole series"', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes: [episode(1, 0, 1), episode(2, 1, 2)],
          files: [file(1, AFTER, 0), file(2, BEFORE, 1)],
          scope: { seasonNumber: 0 },
        }),
      ).toBe(true)
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes: [episode(1, 0, 1), episode(2, 1, 2)],
          files: [file(1, BEFORE, 0), file(2, AFTER, 1)],
          scope: { seasonNumber: 0 },
        }),
      ).toBe(false)
    })
  })

  // A bare request stores no scope, an explicit whole-series one stores
  // `{}`, and `episodeNumber` alone is display-only - all three are the same
  // job and must read the same.
  describe.each([
    ['no scope', undefined],
    ['an empty scope', {}],
    ['a scope with only episodeNumber', { episodeNumber: 5 }],
  ])('a whole series, as %s', (_label, scope) => {
    const episodes = [episode(1, 1, 101), episode(2, 2, 201), episode(3, 2)]

    it('completes when every episode has a new file', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [file(101, AFTER, 1), file(201, LATER, 2)],
          scope,
        }),
      ).toBe(true)
    })

    it('completes on one new file among old ones and missing ones', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [file(101, BEFORE, 1), file(201, AFTER, 2)],
          scope,
        }),
      ).toBe(true)
    })

    it('does not complete when every file is older than the job', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [file(101, BEFORE, 1), file(201, BEFORE, 2)],
          scope,
        }),
      ).toBe(false)
    })

    it('does not complete with no files at all', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [],
          scope,
        }),
      ).toBe(false)
    })
  })
})

describe('didJobComplete, for a job with download links', () => {
  // Two seasons, one file each landed after the job: season 1's by the
  // job's own download, season 2's by an unrelated RSS grab.
  const episodes = [episode(1, 1, 101), episode(2, 2, 201)]
  const files = [file(101, AFTER, 1), file(201, AFTER, 2)]

  describe('a whole series', () => {
    it('does not complete on an unrelated RSS import', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [file(201, AFTER, 2)],
          imports: [imported(RSS, { episodeId: 2, fileId: 201 })],
          links: LINKS,
        }),
      ).toBe(false)
    })

    it("completes on the job's own import", () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files,
          imports: [
            imported(RSS, { episodeId: 2, fileId: 201 }),
            imported(OWN, { episodeId: 1, fileId: 101 }),
          ],
          links: LINKS,
        }),
      ).toBe(true)
    })

    it("does not complete on its own import of a file that isn't new", () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [file(101, BEFORE, 1)],
          imports: [imported(OWN, { episodeId: 1, fileId: 101 })],
          links: LINKS,
        }),
      ).toBe(false)
    })

    it('does not complete with links but no import history read', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files,
          links: LINKS,
        }),
      ).toBe(false)
    })

    // An import record that doesn't name its file still names its episode,
    // and the episode points at the file on disk.
    it("credits the file an import's episode points at", () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files,
          imports: [imported(OWN, { episodeId: 1 })],
          links: LINKS,
        }),
      ).toBe(true)
    })
  })

  describe('a season', () => {
    const scope = { seasonNumber: 2 }

    it('does not complete on an RSS import into its season', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files,
          imports: [
            imported(RSS, { episodeId: 2, fileId: 201 }),
            imported(OWN, { episodeId: 1, fileId: 101 }),
          ],
          links: LINKS,
          scope,
        }),
      ).toBe(false)
    })

    it("completes on the job's own import into its season", () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files,
          imports: [imported(OWN, { episodeId: 2, fileId: 201 })],
          links: LINKS,
          scope,
        }),
      ).toBe(true)
    })

    // Specials are season 0 - a season, not the whole series.
    it('treats season 0 as a season', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes: [episode(1, 0, 101), episode(2, 1, 201)],
          files: [file(101, AFTER, 0), file(201, AFTER, 1)],
          imports: [imported(OWN, { episodeId: 2, fileId: 201 })],
          links: LINKS,
          scope: { seasonNumber: 0 },
        }),
      ).toBe(false)
    })
  })

  describe('a movie', () => {
    it('does not complete on an import of another download', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          files: [file(501, AFTER)],
          imports: [imported(RSS, { fileId: 501 })],
          links: LINKS,
        }),
      ).toBe(false)
    })

    it("completes on the job's own import", () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          files: [file(501, AFTER)],
          imports: [imported(OWN, { fileId: 501 })],
          links: LINKS,
        }),
      ).toBe(true)
    })

    // Radarr before it recorded `fileId`: the import names no file and no
    // episode, and a movie is one file, so a new one is the import's.
    it('credits a new file to its own import that names no file', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          files: [file(501, AFTER)],
          imports: [imported(OWN)],
          links: LINKS,
        }),
      ).toBe(true)
    })

    it('does not credit an unnamed import from before the job', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          files: [file(501, AFTER)],
          imports: [imported(OWN, { date: BEFORE })],
          links: LINKS,
        }),
      ).toBe(false)
    })
  })

  // A job from before links were recorded, or a file imported by hand, has
  // no download to tie a file to - the date alone still decides.
  describe('with no links', () => {
    it.each([
      ['absent', undefined],
      ['empty', []],
    ])('completes on any new file when links are %s', (_label, links) => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          episodes,
          files: [file(201, AFTER, 2)],
          imports: [imported(RSS, { episodeId: 2, fileId: 201 })],
          links,
        }),
      ).toBe(true)
    })

    it('still ignores a file older than the job', () => {
      expect(
        didJobComplete({
          createdAt: CREATED_AT,
          files: [file(501, BEFORE)],
          links: [],
        }),
      ).toBe(false)
    })
  })

  // An episode scope names its one file, so whatever filled it is the job's
  // answer - links or not.
  it('completes an episode job on its episode whichever download filled it', () => {
    expect(
      didJobComplete({
        createdAt: CREATED_AT,
        episodes,
        files,
        imports: [imported(RSS, { episodeId: 2, fileId: 201 })],
        links: LINKS,
        scope: { episodeId: 2, seasonNumber: 2 },
      }),
    ).toBe(true)
  })
})

describe('didJobComplete, while the job still has a queue item', () => {
  const episodes = [episode(1, 3, 301), episode(2, 3, 0)]
  const scope = { episodeId: 1, seasonNumber: 3 }

  // A pack held up on episode 2, or the row Sonarr keeps after a partial
  // manual import: episode 1 is on disk while the item stays.
  it('completes an episode job whose episode has a new file', () => {
    expect(
      didJobComplete({
        createdAt: CREATED_AT,
        episodes,
        files: [file(301, AFTER, 3)],
        queueItem: { episodeHasFile: true },
        scope,
      }),
    ).toBe(true)
  })

  it('does not complete it while Sonarr says the episode has no file', () => {
    expect(
      didJobComplete({
        createdAt: CREATED_AT,
        episodes,
        files: [file(301, AFTER, 3)],
        queueItem: { episodeHasFile: false },
        scope,
      }),
    ).toBe(false)
  })

  // An upgrade in flight: the episode has its old file the whole time.
  it('does not complete it on a file from before the job', () => {
    expect(
      didJobComplete({
        createdAt: CREATED_AT,
        episodes,
        files: [file(301, BEFORE, 3)],
        queueItem: { episodeHasFile: true },
        scope,
      }),
    ).toBe(false)
  })

  it.each([
    ['a season job', { seasonNumber: 3 }],
    ['a whole-series job', undefined],
  ])('never completes %s', (_label, jobScope) => {
    expect(
      didJobComplete({
        createdAt: CREATED_AT,
        episodes,
        files: [file(301, AFTER, 3)],
        imports: [imported(OWN, { episodeId: 1, fileId: 301 })],
        links: LINKS,
        queueItem: { episodeHasFile: true },
        scope: jobScope,
      }),
    ).toBe(false)
  })

  it('never completes a movie job', () => {
    expect(
      didJobComplete({
        createdAt: CREATED_AT,
        files: [file(501, AFTER)],
        queueItem: {},
      }),
    ).toBe(false)
  })
})

describe('completionImports', () => {
  it('keeps the downloadFolderImported records, with their file and episode', () => {
    expect(
      completionImports([
        {
          data: { FileId: '301', indexer: 'secret-url' },
          date: AFTER,
          downloadId: OWN,
          episodeId: 7,
          eventType: 'downloadFolderImported',
        },
        { date: AFTER, downloadId: OWN, eventType: 'grabbed' },
        { date: AFTER, eventType: 'downloadFolderImported' },
        { date: AFTER, downloadId: '', eventType: 'downloadFolderImported' },
      ]),
    ).toEqual([{ date: AFTER, downloadId: OWN, episodeId: 7, fileId: 301 }])
  })

  it('leaves out a fileId that is missing or unparseable', () => {
    expect(
      completionImports([
        { downloadId: OWN, eventType: 'downloadFolderImported' },
        {
          data: { fileId: 'abc' },
          downloadId: RSS,
          eventType: 'downloadFolderImported',
        },
      ]),
    ).toEqual([{ downloadId: OWN }, { downloadId: RSS }])
  })
})

describe('hasFileAddedAfter', () => {
  it('is whether any file is newer than the date', () => {
    expect(
      hasFileAddedAfter([file(1, BEFORE), file(2, AFTER)], CREATED_AT),
    ).toBe(true)
    expect(hasFileAddedAfter([file(1, BEFORE), file(2)], CREATED_AT)).toBe(
      false,
    )
    expect(hasFileAddedAfter([file(2, AFTER)], new Date('nope'))).toBe(false)
  })
})
