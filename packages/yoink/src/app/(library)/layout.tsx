import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { getAuthenticatedUser } from 'src/auth-user'
import { AppShell } from 'src/components/shell/app-shell'
import { redirectToLogin } from 'src/lib/redirect-to-login'

export default async function LibraryLayout({
  children,
}: {
  children: ReactNode
}) {
  const user = await getAuthenticatedUser()

  if (!user) await redirectToLogin()

  if (user!.status !== 'approved') redirect('/pending')

  return <AppShell user={user!}>{children}</AppShell>
}
