import type { DownloadClient } from '@lilnas/utils/download/client'
import type { DownloadJob, DownloadPage } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

import {
  ADMIN_HISTORY_PAGE_SIZE,
  ADMIN_MERGED_SCAN_LIMIT,
  loadAdminHistory,
} from 'src/lib/admin-data'
import type { AdminFilters } from 'src/lib/admin-filters'
import { EMPTY_ADMIN_FILTERS } from 'src/lib/admin-filters'

function job(id: string, email: string, createdAt: string): DownloadJob {
  return {
    completedAt: null,
    createdAt,
    hiddenAttribution: false,
    id,
    media: {
      id: `tmdb:${id}`,
      title: id,
      tmdbId: 1,
      type: DownloadType.Movie,
    },
    requester: { email, userId: `u_${email}` },
    status: DownloadJobStatus.Completed,
    updatedAt: createdAt,
  }
}

type HistoryCall = {
  cursor?: string
  limit?: number
  requester?: string
  status?: DownloadJobStatus[]
  type?: DownloadType[]
}

/**
 * A client whose `getHistory` answers from a per-requester fixture, honouring
 * the `limit` the merge asks for — which is the thing the merge's correctness
 * argument rests on.
 */
function clientFor(byRequester: Record<string, DownloadJob[]>): {
  calls: HistoryCall[]
  client: DownloadClient
} {
  const calls: HistoryCall[] = []

  const getHistory = async (
    query: HistoryCall = {},
  ): Promise<DownloadPage<DownloadJob>> => {
    calls.push(query)

    const all = byRequester[query.requester ?? ''] ?? []
    const items = all.slice(0, query.limit ?? all.length)

    return {
      items,
      nextCursor: items.length < all.length ? 'more' : null,
      total: all.length,
    }
  }

  return { calls, client: { getHistory } as unknown as DownloadClient }
}

const JEREMY = 'jeremy@lilnas.io'
const SAM = 'sam@lilnas.io'

describe('loadAdminHistory — the requester-filtered path', () => {
  it('makes exactly one call and carries the backend cursor through', async () => {
    const { calls, client } = clientFor({
      [SAM]: [job('a', SAM, '2026-09-16T10:00:00.000Z')],
    })

    const page = await loadAdminHistory(
      client,
      { ...EMPTY_ADMIN_FILTERS, requester: SAM },
      'cursor-1',
      [JEREMY, SAM],
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ requester: SAM })
    expect(page.items.map(item => item.id)).toEqual(['a'])
  })

  // The heart of "per-user history is a filter on this view, not a page of its
  // own": the same component tree, narrowed by one query parameter.
  it('never asks about anybody else', async () => {
    const { calls, client } = clientFor({ [SAM]: [], [JEREMY]: [] })

    await loadAdminHistory(
      client,
      { ...EMPTY_ADMIN_FILTERS, requester: SAM },
      null,
      [JEREMY, SAM],
    )

    expect(calls.map(call => call.requester)).toEqual([SAM])
  })
})

describe('loadAdminHistory — the cross-user merge', () => {
  // `GET /download/history` is always scoped to one requester server-side, so
  // "every user" is this function's own interleave rather than a route.
  it('interleaves every requester by createdAt descending', async () => {
    const { client } = clientFor({
      [JEREMY]: [
        job('j1', JEREMY, '2026-09-16T12:00:00.000Z'),
        job('j2', JEREMY, '2026-09-16T09:00:00.000Z'),
      ],
      [SAM]: [
        job('s1', SAM, '2026-09-16T11:00:00.000Z'),
        job('s2', SAM, '2026-09-16T10:00:00.000Z'),
      ],
    })

    const page = await loadAdminHistory(client, EMPTY_ADMIN_FILTERS, null, [
      JEREMY,
      SAM,
    ])

    expect(page.items.map(item => item.id)).toEqual(['j1', 's1', 's2', 'j2'])
  })

  it('reports the exact filtered total across every requester', async () => {
    const { client } = clientFor({
      [JEREMY]: [job('j1', JEREMY, '2026-09-16T12:00:00.000Z')],
      [SAM]: [job('s1', SAM, '2026-09-16T11:00:00.000Z')],
    })

    const page = await loadAdminHistory(client, EMPTY_ADMIN_FILTERS, null, [
      JEREMY,
      SAM,
    ])

    expect(page.total).toBe(2)
  })

  it('scans deep enough that each page is provably complete', async () => {
    const { calls, client } = clientFor({ [JEREMY]: [], [SAM]: [] })

    await loadAdminHistory(client, EMPTY_ADMIN_FILTERS, null, [JEREMY, SAM])

    expect(calls.map(call => call.limit)).toEqual([
      ADMIN_HISTORY_PAGE_SIZE,
      ADMIN_HISTORY_PAGE_SIZE,
    ])
  })

  it('pages with an offset cursor and stops at the scan ceiling', async () => {
    const many = Array.from({ length: 200 }, (_unused, index) =>
      job(
        `j${String(index).padStart(3, '0')}`,
        JEREMY,
        new Date(
          Date.UTC(2026, 8, 16, 12, 0, 0) - index * 60_000,
        ).toISOString(),
      ),
    )
    const { client } = clientFor({ [JEREMY]: many })

    const first = await loadAdminHistory(client, EMPTY_ADMIN_FILTERS, null, [
      JEREMY,
    ])

    expect(first.items).toHaveLength(ADMIN_HISTORY_PAGE_SIZE)
    expect(first.nextCursor).toBe(String(ADMIN_HISTORY_PAGE_SIZE))

    // Walk to the ceiling. The merge cannot prove a deeper page is complete,
    // so it stops offering one — the requester filter is the way further in.
    let cursor = first.nextCursor
    let shown = first.items.length

    while (cursor !== null) {
      const next = await loadAdminHistory(client, EMPTY_ADMIN_FILTERS, cursor, [
        JEREMY,
      ])
      shown += next.items.length
      cursor = next.nextCursor
    }

    expect(shown).toBe(ADMIN_MERGED_SCAN_LIMIT)
  })

  it('answers an empty page when nobody has ever downloaded anything', async () => {
    const { client } = clientFor({})

    await expect(
      loadAdminHistory(client, EMPTY_ADMIN_FILTERS, null, []),
    ).resolves.toEqual({ items: [], nextCursor: null, total: 0 })
  })

  it('applies the type and status filters to every requester', async () => {
    const filters: AdminFilters = {
      ...EMPTY_ADMIN_FILTERS,
      statuses: [DownloadJobStatus.Failed],
      types: [DownloadType.Movie],
    }
    const { calls, client } = clientFor({ [JEREMY]: [], [SAM]: [] })

    await loadAdminHistory(client, filters, null, [JEREMY, SAM])

    for (const call of calls) {
      expect(call).toMatchObject({
        status: [DownloadJobStatus.Failed],
        type: [DownloadType.Movie],
      })
    }
  })
})
