import { eq } from 'drizzle-orm'

import { auth } from 'src/auth'
import { db } from 'src/db'
import { users } from 'src/db/schema'

export async function getAuthenticatedUser() {
  const session = await auth()
  if (!session?.user?.email) return null

  const row = await db.query.users.findFirst({
    where: eq(users.email, session.user.email),
    columns: {
      id: true,
      email: true,
      name: true,
      image: true,
      status: true,
    },
  })

  if (!row) return null

  return {
    ...row,
    isAdmin: row.email === process.env.ADMIN_EMAIL,
  }
}

export type AuthenticatedUser = NonNullable<
  Awaited<ReturnType<typeof getAuthenticatedUser>>
>
