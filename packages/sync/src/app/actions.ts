'use server'

import { eq, sql } from 'drizzle-orm'

import { db } from 'src/db'
import { counters } from 'src/db/schema'

const COUNTER_NAME = 'default'

export async function getCounter(): Promise<number> {
  const result = await db
    .select({ value: counters.value })
    .from(counters)
    .where(eq(counters.name, COUNTER_NAME))
    .limit(1)

  if (result.length === 0) {
    // Initialize counter if it doesn't exist
    const [inserted] = await db
      .insert(counters)
      .values({ name: COUNTER_NAME, value: 0 })
      .returning({ value: counters.value })

    return inserted.value
  }

  return result[0].value
}

export async function incrementCounter(): Promise<number> {
  const [updated] = await db
    .insert(counters)
    .values({ name: COUNTER_NAME, value: 1 })
    .onConflictDoUpdate({
      target: counters.name,
      set: {
        value: sql`${counters.value} + 1`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ value: counters.value })

  return updated.value
}

export async function decrementCounter(): Promise<number> {
  const [updated] = await db
    .insert(counters)
    .values({ name: COUNTER_NAME, value: -1 })
    .onConflictDoUpdate({
      target: counters.name,
      set: {
        value: sql`${counters.value} - 1`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ value: counters.value })

  return updated.value
}
