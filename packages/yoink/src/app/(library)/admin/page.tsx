import { asc } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { AdminContent } from 'src/app/(library)/admin/admin-content'
import { db } from 'src/db'
import { users } from 'src/db/schema'
import { getAuthenticatedUser } from 'src/lib/user-status'

export default async function AdminPage() {
  const currentUser = await getAuthenticatedUser()
  if (!currentUser?.isAdmin) redirect('/')

  const allUsers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      status: users.status,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .orderBy(asc(users.name))

  return (
    <div>
      <h1 className="mb-8 text-3xl">Admin</h1>
      <AdminContent users={allUsers} currentUserId={currentUser.id} />
    </div>
  )
}
