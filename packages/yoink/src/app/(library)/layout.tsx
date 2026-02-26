import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { AppShell } from 'src/components/shell/app-shell'
import { getAuthenticatedUser } from 'src/lib/user-status'

export default async function LibraryLayout({
  children,
}: {
  children: ReactNode
}) {
  const user = await getAuthenticatedUser()

  if (!user) redirect('/login')
  if (user.status !== 'approved') redirect('/pending')

  return <AppShell user={user}>{children}</AppShell>
}
