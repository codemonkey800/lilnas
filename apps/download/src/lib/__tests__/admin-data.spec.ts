import type { DownloadClient } from '@lilnas/utils/download/client'
import type { DownloadJob, DownloadPage } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

import { ADMIN_HISTORY_PAGE_SIZE, loadAdminHistory } from 'src/lib/admin-data'
import type { AdminFilters } from 'src/lib/admin-filters'
import { EMPTY_ADMIN_FILTERS } from 'src/lib/admin-filters'

function job(id: string, email: string | null): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-09-16T10:00:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id,
    linkedDiscord: null,
    media: {
      id: `tmdb:${id}`,
      title: id,
      tmdbId: 1,
      type: DownloadType.Movie,
    },
    requester: email === null ? null : { email, userId: `u_${email}` },
    status: DownloadJobStatus.Completed,
    updatedAt: '2026-09-16T10:00:00.000Z',
  }
}

type HistoryCall = {
  cursor?: string
  limit?: number
  requester?: string
  scope?: 'all'
  status?: DownloadJobStatus[]
  type?: DownloadType[]
}

function clientFor(page: Partial<DownloadPage<DownloadJob>> = {}): {
  calls: HistoryCall[]
  client: DownloadClient
} {
  const calls: HistoryCall[] = []

  const getHistory = async (
    query: HistoryCall = {},
  ): Promise<DownloadPage<DownloadJob>> => {
    calls.push(query)

    return { items: [], nextCursor: null, total: 0, ...page }
  }

  return { calls, client: { getHistory } as unknown as DownloadClient }
}

const SAM = 'sam@lilnas.io'

describe('loadAdminHistory', () => {
  it('asks for one named requester when the filter names one', async () => {
    const { calls, client } = clientFor()

    await loadAdminHistory(
      client,
      { ...EMPTY_ADMIN_FILTERS, requester: SAM },
      'cursor-1',
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ cursor: 'cursor-1', requester: SAM })
  })

  // ⚠️ `scope` and `requester` are mutually exclusive server-side (400), so
  // the filtered branch must not carry one.
  it('never sends a scope alongside a requester', async () => {
    const { calls, client } = clientFor()

    await loadAdminHistory(
      client,
      { ...EMPTY_ADMIN_FILTERS, requester: SAM },
      null,
    )

    expect(calls[0]?.scope).toBeUndefined()
  })

  // Omitting `requester` would mean *the caller's own* history — the admin's
  // own rows under a heading that claims to be the whole system's.
  it('asks for every requester by name when the filter names none', async () => {
    const { calls, client } = clientFor()

    await loadAdminHistory(client, EMPTY_ADMIN_FILTERS, null)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ scope: 'all' })
    expect(calls[0]?.requester).toBeUndefined()
  })

  it('carries the backend cursor and total through untouched', async () => {
    const { client } = clientFor({
      items: [job('a', null), job('b', SAM)],
      nextCursor: 'opaque-backend-cursor',
      total: 417,
    })

    const page = await loadAdminHistory(client, EMPTY_ADMIN_FILTERS, null)

    expect(page.items.map(item => item.id)).toEqual(['a', 'b'])
    expect(page.nextCursor).toBe('opaque-backend-cursor')
    expect(page.total).toBe(417)
  })

  it('requests a full table page', async () => {
    const { calls, client } = clientFor()

    await loadAdminHistory(client, EMPTY_ADMIN_FILTERS, null)

    expect(calls[0]?.limit).toBe(ADMIN_HISTORY_PAGE_SIZE)
  })

  it('passes the type and status filters through', async () => {
    const filters: AdminFilters = {
      ...EMPTY_ADMIN_FILTERS,
      statuses: [DownloadJobStatus.Failed],
      types: [DownloadType.Movie],
    }
    const { calls, client } = clientFor()

    await loadAdminHistory(client, filters, null)

    expect(calls[0]).toMatchObject({
      scope: 'all',
      status: [DownloadJobStatus.Failed],
      type: [DownloadType.Movie],
    })
  })
})
