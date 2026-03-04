'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from 'src/db'
import { users } from 'src/db/schema'
import { getAuthenticatedUser } from 'src/lib/user-status'

async function requireAdmin() {
  const user = await getAuthenticatedUser()
  if (!user?.isAdmin) throw new Error('Unauthorized')
  return user
}

export async function approveUser(userId: string) {
  await requireAdmin()
  await db.update(users).set({ status: 'approved' }).where(eq(users.id, userId))
  revalidatePath('/admin')
}

export async function removeUser(userId: string) {
  const admin = await requireAdmin()
  if (userId === admin.id) throw new Error('Cannot remove yourself')
  await db.update(users).set({ status: 'pending' }).where(eq(users.id, userId))
  revalidatePath('/admin')
}
