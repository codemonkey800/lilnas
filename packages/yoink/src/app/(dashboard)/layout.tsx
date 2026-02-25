import { redirect } from 'next/navigation'

import { AppShell } from 'src/components/shell/app-shell'
import { getAuthenticatedUser } from 'src/lib/user-status'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getAuthenticatedUser()

  if (!user) redirect('/login')
  if (user.status === 'pending') redirect('/pending')
  if (user.status === 'denied') redirect('/login')

  return <AppShell user={user}>{children}</AppShell>
}
