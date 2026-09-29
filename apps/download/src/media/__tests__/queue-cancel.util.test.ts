import { planQueueCancel } from 'src/media/queue-cancel.util'
import { matchesScope, PollableQueueItem } from 'src/media/queue-status.util'

/** One Sonarr row of `downloadId`, for an episode of season 2. */
function row(
  id: number | undefined,
  episodeId: number,
  downloadId?: string,
): PollableQueueItem {
  return { downloadId, episodeId, id, seasonNumber: 2, seriesId: 9 }
}

describe('planQueueCancel', () => {
  const PACK = [row(1, 21, 'pack'), row(2, 22, 'pack'), row(3, 23, 'pack')]

  it('keeps a pack that also carries episodes outside the scope', () => {
    const inScope = (item: PollableQueueItem) =>
      matchesScope(item, { episodeId: 21 })

    const plan = planQueueCancel(PACK.filter(inScope), PACK, inScope)

    expect(plan).toEqual({ kept: ['pack'], remove: [], unnamed: [] })
  })

  it('removes a pack the scope covers whole once, by its first named row', () => {
    const inScope = (item: PollableQueueItem) =>
      matchesScope(item, { seasonNumber: 2 })

    const plan = planQueueCancel(
      [row(undefined, 21, 'pack'), ...PACK.slice(1)],
      PACK,
      inScope,
    )

    expect(plan.kept).toEqual([])
    expect(plan.remove.map(item => item.id)).toEqual([2])
    expect(plan.unnamed).toEqual([])
  })

  it('removes each row with no download id on its own', () => {
    const rows = [row(1, 21), row(2, 22)]

    const plan = planQueueCancel(rows, rows, () => true)

    expect(plan.remove.map(item => item.id)).toEqual([1, 2])
  })

  it('reports a download it cannot name', () => {
    const rows = [row(undefined, 21, 'pack'), row(undefined, 22)]

    const plan = planQueueCancel(rows, rows, () => true)

    expect(plan.remove).toEqual([])
    expect(plan.unnamed).toEqual(rows)
  })

  // A movie has no scope to reach outside of.
  it('never keeps anything without an inScope test', () => {
    const plan = planQueueCancel(PACK.slice(0, 1), PACK)

    expect(plan.kept).toEqual([])
    expect(plan.remove.map(item => item.id)).toEqual([1])
  })
})
