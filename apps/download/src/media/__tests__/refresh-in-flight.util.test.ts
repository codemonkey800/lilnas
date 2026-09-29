import { DownloadType } from '@lilnas/utils/download/types'

import type { CommandSnapshot } from 'src/media/arr-command.types'
import { findRefreshInFlight } from 'src/media/refresh-in-flight.util'

const QUEUED = '2026-09-28T12:00:00.000Z'

function command(
  id: number,
  name: string,
  status: CommandSnapshot['status'],
  body: Record<string, unknown>,
): CommandSnapshot {
  return { body, id, name, queued: QUEUED, status }
}

describe('findRefreshInFlight', () => {
  it.each(['queued', 'started'] as const)(
    'finds a %s add-time series refresh',
    status => {
      const found = findRefreshInFlight(
        [
          command(7, 'RefreshSeries', status, {
            isNewSeries: true,
            seriesIds: [9],
          }),
        ],
        DownloadType.Show,
        9,
      )

      expect(found).toEqual({
        isNew: true,
        ref: { id: 7, name: 'RefreshSeries', queuedAt: QUEUED },
      })
    },
  )

  it.each(['completed', 'failed', 'aborted', 'cancelled', 'orphaned'] as const)(
    'skips a %s refresh',
    status => {
      expect(
        findRefreshInFlight(
          [command(7, 'RefreshMovie', status, { movieIds: [3] })],
          DownloadType.Movie,
          3,
        ),
      ).toBeUndefined()
    },
  )

  it('finds a plain refresh, marked not new', () => {
    expect(
      findRefreshInFlight(
        [command(7, 'RefreshMovie', 'started', { movieIds: [2, 3] })],
        DownloadType.Movie,
        3,
      ),
    ).toMatchObject({ isNew: false, ref: { id: 7 } })
  })

  it("reads Sonarr's single-id form", () => {
    expect(
      findRefreshInFlight(
        [command(7, 'RefreshSeries', 'queued', { seriesId: 9 })],
        DownloadType.Show,
        9,
      ),
    ).toMatchObject({ ref: { id: 7 } })
  })

  it.each([
    ['another title', { seriesIds: [10] }],
    ['the whole library', { seriesIds: [] }],
    ['no ids at all', {}],
  ])('skips a refresh of %s', (_, body) => {
    expect(
      findRefreshInFlight(
        [command(7, 'RefreshSeries', 'started', body)],
        DownloadType.Show,
        9,
      ),
    ).toBeUndefined()
  })

  it("skips the other app's refresh and other commands", () => {
    expect(
      findRefreshInFlight(
        [
          command(7, 'RefreshMovie', 'started', { movieIds: [9] }),
          command(8, 'SeriesSearch', 'started', { seriesId: 9 }),
        ],
        DownloadType.Show,
        9,
      ),
    ).toBeUndefined()
  })

  it('prefers the add-time refresh when both are in flight', () => {
    const plain = command(7, 'RefreshSeries', 'started', { seriesIds: [9] })
    const added = command(8, 'RefreshSeries', 'queued', {
      isNewSeries: true,
      seriesIds: [9],
    })

    expect(
      findRefreshInFlight([plain, added], DownloadType.Show, 9)?.ref.id,
    ).toBe(8)
    expect(
      findRefreshInFlight([added, plain], DownloadType.Show, 9)?.ref.id,
    ).toBe(8)
  })

  it('falls back to now for a refresh with no queue time', () => {
    const unqueued: CommandSnapshot = {
      ...command(7, 'RefreshMovie', 'queued', { movieIds: [3] }),
      queued: undefined,
    }

    const found = findRefreshInFlight([unqueued], DownloadType.Movie, 3)

    expect(Number.isNaN(Date.parse(found?.ref.queuedAt ?? ''))).toBe(false)
  })
})
