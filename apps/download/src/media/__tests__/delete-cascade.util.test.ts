import type { EpisodeResource, QueueResource } from '@lilnas/media/sonarr'

import {
  planShowDelete,
  type ShowDeleteCascade,
} from 'src/media/delete-cascade.util'

/**
 * An episode as Sonarr returns it. `episodeFileId: 0` is Sonarr's "no file",
 * and `hasFile` agrees with it unless a case overrides one on purpose.
 */
function episode(
  id: number,
  seasonNumber: number,
  episodeFileId = 0,
  overrides: Partial<EpisodeResource> = {},
): EpisodeResource {
  return {
    episodeFileId,
    hasFile: episodeFileId > 0,
    id,
    seasonNumber,
    ...overrides,
  }
}

/**
 * A queue item. `getQueue([sonarrId])` already narrows the queue to one
 * series, so every item here belongs to the series being planned; what
 * varies is how precisely Sonarr could place it - an episode, a season, or
 * neither.
 */
function queued(overrides: Partial<QueueResource> = {}): QueueResource {
  return { id: 5000, seriesId: 77, ...overrides }
}

/** One row of the "what still counts as remaining" matrix. */
interface RemainingCase {
  cascade: ShowDeleteCascade
  name: string
  other: EpisodeResource
  queue: QueueResource[]
}

describe('planShowDelete', () => {
  describe('an episode scope', () => {
    it('deletes only that episode file and unmonitors only that episode', () => {
      const plan = planShowDelete(
        [episode(1, 3, 101), episode(2, 3, 102)],
        [],
        { episodeId: 1 },
      )

      expect(plan).toEqual({
        cascade: 'none',
        fileCount: 1,
        fileIds: [101],
        seasonNumbersToUnmonitor: [],
        unmonitorScope: { episodeId: 1 },
      })
    })

    it('deletes no files when the episode has none', () => {
      const plan = planShowDelete([episode(1, 3), episode(2, 3, 102)], [], {
        episodeId: 1,
      })

      expect(plan).toEqual({
        cascade: 'none',
        fileCount: 0,
        fileIds: [],
        seasonNumbersToUnmonitor: [],
        unmonitorScope: { episodeId: 1 },
      })
    })

    it('cascades to the season when it was the last one left in it', () => {
      const plan = planShowDelete(
        [episode(1, 3, 101), episode(2, 3), episode(3, 4, 103)],
        [],
        { episodeId: 1 },
      )

      expect(plan).toEqual({
        cascade: 'season',
        fileCount: 1,
        fileIds: [101],
        seasonNumbersToUnmonitor: [3],
        unmonitorScope: { seasonNumber: 3 },
      })
    })

    it('cascades to the series when the season was the last one left', () => {
      const plan = planShowDelete(
        [episode(1, 3, 101), episode(2, 3), episode(3, 4)],
        [],
        { episodeId: 1 },
      )

      // `fileIds` is empty because Sonarr deletes the series folder, but the
      // file still counted towards what this delete removed.
      expect(plan).toEqual({
        cascade: 'series',
        fileCount: 1,
        fileIds: [],
        seasonNumbersToUnmonitor: [],
        unmonitorScope: undefined,
      })
    })

    it('ignores its own in-flight queue item when deciding the season', () => {
      // The episode being deleted is downloading; that download is what the
      // delete cancels, so it must not keep its own season alive.
      const plan = planShowDelete(
        [episode(1, 3, 101), episode(2, 3), episode(3, 4, 103)],
        [queued({ episodeId: 1, seasonNumber: 3 })],
        { episodeId: 1 },
      )

      expect(plan.cascade).toBe('season')
    })

    it('keeps the season alive for a queue item pinned to no episode', () => {
      const plan = planShowDelete(
        [episode(1, 3, 101), episode(2, 3), episode(3, 4, 103)],
        [queued({ seasonNumber: 3 })],
        { episodeId: 1 },
      )

      expect(plan).toEqual({
        cascade: 'none',
        fileCount: 1,
        fileIds: [101],
        seasonNumbersToUnmonitor: [],
        unmonitorScope: { episodeId: 1 },
      })
    })

    it('keeps the series alive for a queue item pinned to nothing', () => {
      const plan = planShowDelete(
        [episode(1, 3, 101), episode(2, 3)],
        [queued()],
        {
          episodeId: 1,
        },
      )

      expect(plan.cascade).toBe('season')
      expect(plan.seasonNumbersToUnmonitor).toEqual([3])
    })

    it('keeps the series alive for a queue item in another season', () => {
      const plan = planShowDelete(
        [episode(1, 3, 101), episode(2, 3)],
        [queued({ seasonNumber: 4 })],
        { episodeId: 1 },
      )

      expect(plan.cascade).toBe('season')
    })

    it('unmonitors the scope it was given for an unknown episode id', () => {
      // A zero-delete is a success: nothing to remove, but the caller still
      // unmonitors what it was asked to.
      const plan = planShowDelete([episode(1, 3, 101)], [], { episodeId: 999 })

      expect(plan).toEqual({
        cascade: 'none',
        fileCount: 0,
        fileIds: [],
        seasonNumbersToUnmonitor: [],
        unmonitorScope: { episodeId: 999 },
      })
    })

    it('treats season 0 as a real season to cascade into', () => {
      const plan = planShowDelete(
        [episode(1, 0, 101), episode(2, 0), episode(3, 1, 103)],
        [],
        { episodeId: 1 },
      )

      expect(plan).toEqual({
        cascade: 'season',
        fileCount: 1,
        fileIds: [101],
        seasonNumbersToUnmonitor: [0],
        unmonitorScope: { seasonNumber: 0 },
      })
    })

    it('takes precedence over a season number in the same scope', () => {
      const plan = planShowDelete(
        [episode(1, 3, 101), episode(2, 3, 102)],
        [],
        { episodeId: 1, seasonNumber: 3 },
      )

      expect(plan.fileIds).toEqual([101])
      expect(plan.unmonitorScope).toEqual({ episodeId: 1 })
    })

    it('ignores episodes Sonarr could not place in a season', () => {
      // No season number means the episode cannot be matched to a season or
      // counted against one, so it holds nothing open.
      const plan = planShowDelete(
        [
          episode(1, 3, 101),
          { episodeFileId: 102, hasFile: true, id: 2 },
          { episodeFileId: 103, hasFile: true, seasonNumber: 4 },
        ],
        [],
        { episodeId: 1 },
      )

      expect(plan.cascade).toBe('series')
      expect(plan.fileCount).toBe(1)
    })

    describe('what keeps the season from being unmonitored', () => {
      // Episode 1 of season 3 is deleted; season 4 always has a file, so the
      // cascade can never reach the series here. What varies is whether the
      // sibling episode 2 still counts as remaining.
      const cases: RemainingCase[] = [
        {
          cascade: 'none',
          name: 'a file on disk',
          other: episode(2, 3, 102),
          queue: [],
        },
        {
          cascade: 'none',
          name: 'a queue item',
          other: episode(2, 3),
          queue: [queued({ episodeId: 2, seasonNumber: 3 })],
        },
        {
          cascade: 'none',
          name: 'both a file and a queue item',
          other: episode(2, 3, 102),
          queue: [queued({ episodeId: 2, seasonNumber: 3 })],
        },
        {
          cascade: 'season',
          name: 'neither',
          other: episode(2, 3),
          queue: [],
        },
      ]

      it.each(cases)(
        'is $cascade when the other episode of the season has $name',
        ({ cascade, other, queue }) => {
          const plan = planShowDelete(
            [episode(1, 3, 101), other, episode(3, 4, 103)],
            queue,
            { episodeId: 1 },
          )

          expect(plan.cascade).toBe(cascade)
        },
      )
    })
  })

  describe('a season scope', () => {
    it('deletes every file in the season and unmonitors it', () => {
      const plan = planShowDelete(
        [
          episode(1, 3, 101),
          episode(2, 3, 102),
          episode(3, 3),
          episode(4, 4, 104),
        ],
        [],
        { seasonNumber: 3 },
      )

      expect(plan).toEqual({
        cascade: 'season',
        fileCount: 2,
        fileIds: [101, 102],
        seasonNumbersToUnmonitor: [3],
        unmonitorScope: { seasonNumber: 3 },
      })
    })

    it('lists a file backing several episodes once', () => {
      // A multi-episode file is the same `episodeFileId` on each episode.
      const plan = planShowDelete(
        [episode(1, 3, 101), episode(2, 3, 101), episode(3, 4, 103)],
        [],
        { seasonNumber: 3 },
      )

      expect(plan.fileIds).toEqual([101])
      expect(plan.fileCount).toBe(1)
    })

    it('still unmonitors a season that has nothing on disk', () => {
      const plan = planShowDelete(
        [episode(1, 3), episode(2, 3), episode(3, 4, 103)],
        [],
        { seasonNumber: 3 },
      )

      expect(plan).toEqual({
        cascade: 'season',
        fileCount: 0,
        fileIds: [],
        seasonNumbersToUnmonitor: [3],
        unmonitorScope: { seasonNumber: 3 },
      })
    })

    it('cascades an empty season to the series when nothing else remains', () => {
      const plan = planShowDelete([episode(1, 3), episode(2, 4)], [], {
        seasonNumber: 3,
      })

      expect(plan).toEqual({
        cascade: 'series',
        fileCount: 0,
        fileIds: [],
        seasonNumbersToUnmonitor: [],
        unmonitorScope: undefined,
      })
    })

    it('cascades to the series when it was the last season with anything', () => {
      const plan = planShowDelete(
        [episode(1, 3, 101), episode(2, 3, 102), episode(3, 4)],
        [],
        { seasonNumber: 3 },
      )

      expect(plan).toEqual({
        cascade: 'series',
        fileCount: 2,
        fileIds: [],
        seasonNumbersToUnmonitor: [],
        unmonitorScope: undefined,
      })
    })

    it('keeps the series alive for a queue item pinned to nothing', () => {
      const plan = planShowDelete(
        [episode(1, 3, 101), episode(2, 4)],
        [queued()],
        { seasonNumber: 3 },
      )

      expect(plan).toEqual({
        cascade: 'season',
        fileCount: 1,
        fileIds: [101],
        seasonNumbersToUnmonitor: [3],
        unmonitorScope: { seasonNumber: 3 },
      })
    })

    it('ignores a queue item for the season being deleted', () => {
      const plan = planShowDelete(
        [episode(1, 3, 101), episode(2, 4)],
        [queued({ seasonNumber: 3 })],
        { seasonNumber: 3 },
      )

      expect(plan.cascade).toBe('series')
    })

    it('treats season 0 as a real season on both sides of the rule', () => {
      const specials = planShowDelete(
        [episode(1, 0, 101), episode(2, 1, 102)],
        [],
        { seasonNumber: 0 },
      )

      expect(specials).toEqual({
        cascade: 'season',
        fileCount: 1,
        fileIds: [101],
        seasonNumbersToUnmonitor: [0],
        unmonitorScope: { seasonNumber: 0 },
      })

      // And specials left on disk keep the series alive when season 1 goes.
      const firstSeason = planShowDelete(
        [episode(1, 0, 101), episode(2, 1, 102)],
        [],
        { seasonNumber: 1 },
      )

      expect(firstSeason.cascade).toBe('season')
      expect(firstSeason.seasonNumbersToUnmonitor).toEqual([1])
    })

    describe('what keeps the series from being removed', () => {
      // Season 3 is deleted; what varies is whether the one episode of
      // season 4 still counts as remaining.
      const cases: RemainingCase[] = [
        {
          cascade: 'season',
          name: 'a file on disk',
          other: episode(2, 4, 104),
          queue: [],
        },
        {
          cascade: 'season',
          name: 'a queue item',
          other: episode(2, 4),
          queue: [queued({ episodeId: 2, seasonNumber: 4 })],
        },
        {
          cascade: 'season',
          name: 'both a file and a queue item',
          other: episode(2, 4, 104),
          queue: [queued({ episodeId: 2, seasonNumber: 4 })],
        },
        {
          cascade: 'series',
          name: 'neither',
          other: episode(2, 4),
          queue: [],
        },
      ]

      it.each(cases)(
        'is $cascade when the other season has $name',
        ({ cascade, other, queue }) => {
          const plan = planShowDelete([episode(1, 3, 101), other], queue, {
            seasonNumber: 3,
          })

          expect(plan.cascade).toBe(cascade)
        },
      )
    })
  })

  describe('an empty scope', () => {
    it('removes the series and counts every file it takes with it', () => {
      const plan = planShowDelete(
        [
          episode(1, 0, 100),
          episode(2, 1, 101),
          episode(3, 1),
          episode(4, 2, 102),
        ],
        [],
        {},
      )

      expect(plan).toEqual({
        cascade: 'series',
        fileCount: 3,
        fileIds: [],
        seasonNumbersToUnmonitor: [],
        unmonitorScope: undefined,
      })
    })

    it('counts a file backing several episodes once', () => {
      const plan = planShowDelete(
        [episode(1, 1, 101), episode(2, 1, 101), episode(3, 2, 101)],
        [],
        {},
      )

      expect(plan.fileCount).toBe(1)
    })

    it('removes a series with nothing on disk', () => {
      const plan = planShowDelete(
        [episode(1, 1), episode(2, 1)],
        [queued()],
        {},
      )

      expect(plan).toEqual({
        cascade: 'series',
        fileCount: 0,
        fileIds: [],
        seasonNumbersToUnmonitor: [],
        unmonitorScope: undefined,
      })
    })

    it('removes a series Sonarr listed no episodes for', () => {
      const plan = planShowDelete([], [], {})

      expect(plan.cascade).toBe('series')
      expect(plan.fileCount).toBe(0)
    })
  })
})
