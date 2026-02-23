import { Clock } from 'lucide-react'
import { redirect } from 'next/navigation'

import { signOutAction } from 'src/app/login/actions'
import { Button } from 'src/components/button'
import { Card, CardContent } from 'src/components/card'
import { EmptyState } from 'src/components/empty-state'
import { StatusBadge } from 'src/components/status-badge'
import { getAuthenticatedUser } from 'src/lib/user-status'

export default async function PendingPage() {
  const user = await getAuthenticatedUser()

  if (!user) redirect('/login')
  if (user.status === 'approved') redirect('/')
  if (user.status === 'denied') redirect('/login')

  return (
    <div className="flex min-h-dvh items-center justify-center bg-carbon-950">
      <div className="scanlines pointer-events-none fixed inset-0" />

      <Card
        variant="glow"
        className="animate-fade-in-glow relative z-10 w-full max-w-sm"
      >
        <CardContent className="px-6 py-8">
          <EmptyState
            icon={<Clock className="text-warning" />}
            title="Pending Approval"
            description="Your account is awaiting admin approval. Check back later."
            action={
              <div className="flex flex-col items-center gap-4">
                <StatusBadge status="pending" />
                <form action={signOutAction}>
                  <Button type="submit" variant="secondary" size="sm">
                    Sign out
                  </Button>
                </form>
              </div>
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}
