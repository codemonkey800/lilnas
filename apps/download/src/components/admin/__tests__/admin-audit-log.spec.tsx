import '@testing-library/jest-dom'

import type { AuditLogEntry } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import { AdminAuditLog } from 'src/components/admin/admin-audit-log'
import { AUDIT_SERVICE_LABEL } from 'src/lib/admin-audit'
import { EMPTY_ADMIN_FILTERS } from 'src/lib/admin-filters'

const NOW = Date.parse('2026-09-16T16:00:00.000Z')

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    action: 'video.create',
    actor: { email: 'jeremy@lilnas.io', userId: 'u_jeremy' },
    createdAt: '2026-09-16T15:42:08.000Z',
    id: 1,
    metadata: null,
    origin: 'web',
    targetId: 'job-1',
    targetType: 'job',
    ...overrides,
  }
}

function renderLog(entries: AuditLogEntry[]) {
  return render(
    <AdminAuditLog entries={entries} filters={EMPTY_ADMIN_FILTERS} now={NOW} />,
  )
}

describe('AdminAuditLog', () => {
  // ⚠️ The defining case. `actor: null` on this page is a *service* caller with
  // no forwarded identity — NOT the masked attribution the same `null` means on
  // every other page, because nothing on /admin is masked.
  it('renders a null actor as the service, not as a hidden or anonymous user', () => {
    renderLog([entry({ actor: null, origin: 'service' })])

    expect(screen.getByText(AUDIT_SERVICE_LABEL)).toBeInTheDocument()
    expect(screen.queryByText('hidden')).not.toBeInTheDocument()
    expect(screen.queryByText('–')).not.toBeInTheDocument()
    expect(screen.queryByText('unknown')).not.toBeInTheDocument()
    // Nothing to open a profile or a per-user filter for — a service is not a
    // person, so it gets no link.
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('says so out loud when a web request arrived with no identity', () => {
    renderLog([entry({ actor: null, origin: 'web' })])

    expect(screen.getByText('unattributed web request')).toBeInTheDocument()
    expect(screen.queryByText(AUDIT_SERVICE_LABEL)).not.toBeInTheDocument()
  })

  it('shows the real actor email, unmasked, linked to their own view', () => {
    renderLog([entry()])
    const link = screen.getByRole('link', { name: 'jeremy@lilnas.io' })

    expect(link).toHaveAttribute('href', '/admin?requester=jeremy%40lilnas.io')
  })

  it('derives the level word and its tint from the action', () => {
    renderLog([
      entry({ action: 'video.delete', id: 2 }),
      entry({ action: 'file.flag_bad', id: 3 }),
    ])

    // The tint is asserted on the rendered class attribute, never on a composed
    // input string — `cns()` reshapes the list after composition.
    expect(screen.getByText('DELETE').getAttribute('class')).toContain(
      'text-bad',
    )
    expect(screen.getByText('FLAG').getAttribute('class')).toContain(
      'text-warn',
    )
  })

  // `metadata` is deliberately untyped upstream — "per-action detail rendered
  // as key/value pairs, never branched on" — so it is shown as JSON rather than
  // given a shape the frontend would have to grow for every new action.
  it('renders metadata as formatted JSON behind a disclosure', () => {
    renderLog([
      entry({
        metadata: { attempts: 3, indexer: 'nzbgeek', somethingNew: [true] },
      }),
    ])

    expect(screen.getByText('metadata')).toBeInTheDocument()
    expect(screen.getByText(/"indexer": "nzbgeek"/)).toBeInTheDocument()
    expect(screen.getByText(/"somethingNew"/)).toBeInTheDocument()
  })

  it('draws no disclosure when there is no metadata to open', () => {
    renderLog([
      entry({ metadata: null, id: 4 }),
      entry({ metadata: {}, id: 5 }),
    ])

    expect(screen.queryByText('metadata')).not.toBeInTheDocument()
  })

  it('renders the target when there is one and nothing when there is not', () => {
    renderLog([
      entry({ id: 6 }),
      entry({
        action: 'ytdlp.check_update',
        id: 7,
        targetId: null,
        targetType: null,
      }),
    ])

    expect(screen.getByText('· job job-1')).toBeInTheDocument()
    expect(screen.getByText(/checked for a yt-dlp update/)).toBeInTheDocument()
  })

  // Relative against one pinned server instant, with the exact timestamp on the
  // title — a wall clock would have to pick a timezone, and the two sides of
  // hydration would not agree on which.
  it('stamps each line relative to the pinned instant', () => {
    renderLog([entry()])
    const stamp = screen.getByTitle('2026-09-16T15:42:08.000Z')

    expect(stamp).toHaveTextContent('17m ago')
  })

  it('has its own empty state rather than an empty card', () => {
    renderLog([])

    expect(
      screen.getByText(/nothing has been recorded yet/),
    ).toBeInTheDocument()
  })
})
