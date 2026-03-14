import ScheduleIcon from '@mui/icons-material/Schedule'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import { redirect } from 'next/navigation'

import { getAuthenticatedUser } from 'src/auth-user'
import { EmptyState } from 'src/components/empty-state'
import { StatusBadge } from 'src/components/status-badge'
import { YoinkLogo } from 'src/components/yoink-logo'
import { redirectToLogin } from 'src/lib/redirect-to-login'

export default async function PendingPage() {
  const user = await getAuthenticatedUser()

  if (!user) await redirectToLogin()
  if (user!.status === 'approved') redirect('/')

  return (
    <div className="flex min-h-dvh items-center justify-center bg-carbon-950">
      <div className="scanlines pointer-events-none fixed inset-0" />

      <Card
        className="animate-fade-in-glow relative z-10 w-full max-w-sm"
        sx={{
          borderColor: 'rgba(57, 255, 20, 0.2)',
          boxShadow: '0 0 16px rgba(57, 255, 20, 0.08)',
          '&:hover': {
            boxShadow: '0 0 24px rgba(57, 255, 20, 0.15)',
            borderColor: 'rgba(57, 255, 20, 0.4)',
          },
        }}
      >
        <CardContent className="flex flex-col items-center gap-4 px-6 py-8">
          <YoinkLogo className="h-36 text-terminal" />
          <EmptyState
            className="py-0"
            icon={<ScheduleIcon className="text-warning" />}
            title="Pending Approval"
            description="Your account is awaiting admin approval. Check back later."
            action={
              <div className="flex flex-col items-center gap-4">
                <StatusBadge status="pending" />
                <form action="/api/auth/logout" method="post">
                  <Button
                    type="submit"
                    variant="outlined"
                    color="secondary"
                    size="small"
                  >
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
