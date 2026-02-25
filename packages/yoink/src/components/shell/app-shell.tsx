import { signOutAction } from 'src/app/(auth)/login/actions'
import { AppSidebar } from 'src/components/shell/app-sidebar'
import { SiteHeader } from 'src/components/shell/site-header'
import { SidebarInset, SidebarProvider } from 'src/components/ui/sidebar'
import type { AuthenticatedUser } from 'src/lib/user-status'

export function AppShell({
  user,
  children,
}: {
  user: AuthenticatedUser
  children: React.ReactNode
}) {
  return (
    <SidebarProvider className="flex flex-col">
      <SiteHeader user={user} signOutAction={signOutAction} />
      <div className="flex flex-1">
        <AppSidebar isAdmin={user.isAdmin} />
        <SidebarInset>
          <div className="mx-auto w-full max-w-6xl p-4 md:p-6">{children}</div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
