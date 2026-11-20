'use client'

import {
  Badge,
  Button,
  type Column,
  DataList,
  Density,
  EmptyState,
  Note,
  Skeleton,
} from '@lilnas/ui'
import Link from 'next/link'
import { type JSX, useEffect, useState } from 'react'

import { STATE_BADGES } from 'src/lib/admin-state'
import { ApiError, getAdminAccounts } from 'src/lib/api'
import { formatBytes, formatCount, formatRelative } from 'src/lib/format'
import type { AdminAccountRow } from 'src/shared/contract'

type Load =
  | { status: 'loading' }
  | { status: 'ready'; rows: AdminAccountRow[] }
  | { status: 'forbidden' }
  | { status: 'error'; error: ApiError | Error }

const COLUMNS: Column<AdminAccountRow>[] = [
  {
    key: 'person',
    header: 'Person',
    primary: true,
    render: row => row.email,
  },
  {
    key: 'appleId',
    header: 'Apple ID',
    mono: true,
    render: row => row.appleId,
  },
  {
    key: 'folder',
    header: 'Folder',
    mono: true,
    render: row => row.folder,
  },
  {
    key: 'state',
    header: 'State',
    render: row => {
      if (!row.state) return <span className="text-ink-4">—</span>
      const { tone, label, live } = STATE_BADGES[row.state]
      return (
        <Badge data-tone={tone} live={live} tone={tone}>
          {label}
        </Badge>
      )
    },
  },
  {
    key: 'last',
    header: 'Last backup',
    render: row =>
      row.lastBackupAt ? formatRelative(row.lastBackupAt) || '—' : '—',
  },
  {
    key: 'items',
    header: 'Items',
    align: 'right',
    render: row => formatCount(row.totalItems),
  },
  {
    key: 'size',
    header: 'Size on disk',
    align: 'right',
    render: row => formatBytes(row.totalBytes),
  },
  {
    key: 'immich',
    header: 'Immich',
    render: row => (
      <Badge tone={row.hasImmich ? 'ok' : 'mute'}>
        {row.hasImmich ? 'Linked' : 'None'}
      </Badge>
    ),
  },
]

function AdminSkeleton(): JSX.Element {
  return (
    <div
      aria-busy="true"
      aria-label="Loading backups"
      className="flex flex-col gap-2"
      role="status"
    >
      {[0, 1, 2, 3].map(i => (
        <div
          className="flex flex-col gap-2 rounded-lg border border-line p-4 md:flex-row md:items-center md:gap-6"
          key={i}
        >
          <Skeleton className="h-4 w-1/2 md:w-40" />
          <Skeleton className="h-4 w-3/4 md:w-44" />
          <Skeleton className="hidden h-4 w-20 md:block" />
          <Skeleton className="hidden h-4 w-24 md:ml-auto md:block" />
        </div>
      ))}
    </div>
  )
}

async function fetchRows(): Promise<Load> {
  try {
    return { status: 'ready', rows: await getAdminAccounts() }
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      return { status: 'forbidden' }
    }
    return {
      status: 'error',
      error: e instanceof Error ? e : new Error(String(e)),
    }
  }
}

/**
 * The read-only admin page: everyone's backup in a table (a list on a phone).
 * There is no live feed; Refresh loads it again.
 */
export function AdminPage(): JSX.Element {
  // Each request gets a number; its result is kept with that number, so a
  // load still in flight is known by `result.request !== request`.
  const [request, setRequest] = useState(0)
  const [result, setResult] = useState<{ request: number; load: Load }>()

  useEffect(() => {
    let current = true
    void fetchRows().then(load => {
      if (current) setResult({ request, load })
    })
    return () => {
      current = false
    }
  }, [request])

  const pending = result?.request !== request
  // A refresh keeps the rows on screen; the first load and a retry do not.
  const load: Load = result?.load ?? { status: 'loading' }
  const reload = (): void => setRequest(r => r + 1)

  const retry = (): void => {
    setResult(undefined)
    reload()
  }

  return (
    <Density mode="compact">
      <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-8 sm:py-10">
        {load.status === 'forbidden' ? (
          <EmptyState
            action={
              <Button render={<Link href="/" />} variant="accent">
                Go to my backup
              </Button>
            }
            title="This page is for admins"
          />
        ) : (
          <>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h1 className="text-h1">Backups</h1>
                <p className="mt-1 text-sm text-ink-3">
                  Everyone who has signed in. This page is read-only.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button render={<Link href="/" />} size="sm" variant="ghost">
                  My backup
                </Button>
                <Button
                  disabled={pending}
                  onClick={reload}
                  size="sm"
                  variant="outline"
                >
                  Refresh
                </Button>
              </div>
            </div>

            {load.status === 'loading' ? <AdminSkeleton /> : null}

            {load.status === 'error' ? (
              <div className="flex max-w-[520px] flex-col items-start gap-4">
                <Note lead="Couldn't load the backups." tone="bad">
                  {load.error.message}
                </Note>
                <Button onClick={retry} variant="accent">
                  Try again
                </Button>
              </div>
            ) : null}

            {load.status === 'ready' ? (
              <DataList
                caption="Backups"
                columns={COLUMNS}
                empty={
                  <EmptyState
                    body="When someone signs in, their backup shows up here."
                    title="Nobody has set up a backup yet"
                  />
                }
                rowKey={row => row.email}
                rows={load.rows}
              />
            ) : null}
          </>
        )}
      </main>
    </Density>
  )
}
