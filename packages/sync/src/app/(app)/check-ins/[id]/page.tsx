import { notFound } from 'next/navigation'

import {
  getActionItemsForCheckIn,
  getCheckIn,
} from 'src/app/(app)/check-ins/queries'
import { auth } from 'src/auth'

import { CheckInActiveView } from './check-in-active-view'
import { CheckInDraftView } from './check-in-draft-view'
import { CheckInResultsView } from './check-in-results-view'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CheckInDetailPageProps {
  params: Promise<{ id: string }>
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({ params }: CheckInDetailPageProps) {
  const { id } = await params
  const checkIn = await getCheckIn(id)

  return {
    title: checkIn ? `${checkIn.title} — Sync` : 'Check-in — Sync',
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function CheckInDetailPage({
  params,
}: CheckInDetailPageProps) {
  const { id } = await params

  const [checkIn, session] = await Promise.all([getCheckIn(id), auth()])

  if (!checkIn || !session?.user?.id) {
    notFound()
  }

  const userId = session.user.id

  // Fetch action items for in_progress and completed views
  const needsActionItems =
    checkIn.status === 'in_progress' || checkIn.status === 'completed'
  const actionItems = needsActionItems ? await getActionItemsForCheckIn(id) : []

  switch (checkIn.status) {
    case 'draft':
    case 'scheduled':
      return <CheckInDraftView checkIn={checkIn} userId={userId} />

    case 'in_progress':
      return (
        <CheckInActiveView
          checkIn={checkIn}
          userId={userId}
          actionItems={actionItems}
        />
      )

    case 'completed':
      return (
        <CheckInResultsView
          checkIn={checkIn}
          userId={userId}
          actionItems={actionItems}
        />
      )

    default:
      notFound()
  }
}
