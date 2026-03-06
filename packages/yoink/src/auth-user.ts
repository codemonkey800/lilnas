import { eq } from 'drizzle-orm'
import { jwtVerify } from 'jose'
import { cookies } from 'next/headers'

import { db } from 'src/db'
import { users } from 'src/db/schema'

const AUTH_TOKEN_COOKIE = 'auth-token'

interface JwtPayload {
  sub: string
  email: string
}

export async function getAuthenticatedUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get(AUTH_TOKEN_COOKIE)?.value
  if (!token) return null

  const secret = new TextEncoder().encode(process.env.JWT_SECRET)
  let payload: JwtPayload
  try {
    const { payload: p } = await jwtVerify(token, secret)
    payload = p as unknown as JwtPayload
  } catch {
    return null
  }

  if (!payload.sub) return null

  const row = await db.query.users.findFirst({
    where: eq(users.id, payload.sub),
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
