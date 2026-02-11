import Link from 'next/link'
import { HiCalendarDays, HiChatBubbleLeftRight, HiPlus } from 'react-icons/hi2'

import { CheckInStatusBadge } from 'src/components/check-in-status-badge'
import { Badge } from 'src/components/ui/badge'
import { Button } from 'src/components/ui/button'

import { formatCheckInDate } from './helpers'
import { getCheckIns } from './queries'
import type { CheckInListItem } from './types'

export const metadata = {
  title: 'Check-ins — Sync',
}

export default async function CheckInsPage() {
  const checkIns = await getCheckIns()

  return (
    <div className="flex flex-col gap-6 py-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-text md:text-3xl">
          Check-ins
        </h1>

        {checkIns && (
          <Link href="/check-ins/new">
            <Button size="sm">
              <HiPlus className="h-4 w-4" />
              New Check-in
            </Button>
          </Link>
        )}
      </div>

      {/* Content */}
      {checkIns ? (
        checkIns.length > 0 ? (
          <div className="flex flex-col gap-3">
            {checkIns.map(checkIn => (
              <CheckInCard key={checkIn.id} checkIn={checkIn} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-md border border-border-subtle bg-bg-raised py-10">
            <HiChatBubbleLeftRight className="h-8 w-8 text-text-muted" />
            <p className="text-sm text-text-muted">No check-ins yet.</p>
            <Link
              href="/check-ins/new"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-400 transition-colors duration-150 ease-smooth hover:text-primary-300"
            >
              <HiPlus className="h-4 w-4" />
              Start your first check-in
            </Link>
          </div>
        )
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-md border border-border-subtle bg-bg-raised py-10">
          <p className="text-sm text-text-muted">
            Connect with a partner to start check-ins.
          </p>
          <Link
            href="/partner"
            className="text-sm font-medium text-primary-400 transition-colors duration-150 ease-smooth hover:text-primary-300"
          >
            Set up your partnership
          </Link>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CheckInCard
// ---------------------------------------------------------------------------

function CheckInCard({ checkIn }: { checkIn: CheckInListItem }) {
  const displayDate = formatCheckInDate(checkIn)

  return (
    <Link
      href={`/check-ins/${checkIn.id}`}
      className="group flex flex-col gap-2 rounded-md border border-border bg-bg-surface p-4 shadow-md transition-all duration-150 ease-smooth hover:border-primary-700 hover:shadow-glow"
    >
      {/* Top row: title + status */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-text group-hover:text-primary-300 transition-colors duration-150 ease-smooth">
          {checkIn.title}
        </h3>
        <CheckInStatusBadge status={checkIn.status} />
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3">
        <Badge variant="neutral">
          {checkIn.questionCount}{' '}
          {checkIn.questionCount === 1 ? 'question' : 'questions'}
        </Badge>

        {displayDate && (
          <span className="inline-flex items-center gap-1 text-xs text-text-muted">
            <HiCalendarDays className="h-3.5 w-3.5" />
            {displayDate}
          </span>
        )}
      </div>
    </Link>
  )
}
