import { AdminDashboardClient } from './admin-dashboard-client'
import {
  fetchAdminServices,
  fetchAdminUsers,
  requireAdminQueue,
} from './require-admin'

// The merged admin dashboard — replaces the pre-redesign 3-page split
// (/admin, /admin/queue, /admin/users) with one screen. requireAdminQueue()
// is both the session/admin check (redirects to /login otherwise — see
// require-admin.ts's own comment) and the pending-queue data itself;
// fetchAdminUsers()/fetchAdminServices() share that same guard.
export default async function AdminPage() {
  const [queue, users, services] = await Promise.all([
    requireAdminQueue(),
    fetchAdminUsers(),
    fetchAdminServices(),
  ])

  return (
    <AdminDashboardClient
      initialQueue={queue}
      initialUsers={users}
      services={services}
    />
  )
}
