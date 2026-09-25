import { AdminDashboardClient } from './admin-dashboard-client'
import {
  fetchAdminServices,
  fetchAdminUsers,
  fetchDiscordLinks,
  fetchDiscordUnlinked,
  requireAdminQueue,
} from './require-admin'

// The merged admin dashboard — replaces the pre-redesign 3-page split
// (/admin, /admin/queue, /admin/users) with one screen. requireAdminQueue()
// is both the session/admin check (redirects to /login otherwise — see
// require-admin.ts's own comment) and the pending-queue data itself;
// fetchAdminUsers()/fetchAdminServices()/the two Discord fetches share that
// same guard.
//
// All five run concurrently rather than sequentially: they are independent
// reads against the same already-authorized backend, and the guard property
// is unaffected by the concurrency — an unauthorized request makes EVERY
// one of them 401, and Promise.all rejects with whichever redirect() throws
// first, which is the same /login navigation regardless of which won.
export default async function AdminPage() {
  const [queue, users, services, discordUnlinked, discordLinks] =
    await Promise.all([
      requireAdminQueue(),
      fetchAdminUsers(),
      fetchAdminServices(),
      fetchDiscordUnlinked(),
      fetchDiscordLinks(),
    ])

  return (
    <AdminDashboardClient
      initialQueue={queue}
      initialUsers={users}
      services={services}
      discordUnlinked={discordUnlinked}
      discordLinks={discordLinks}
    />
  )
}
