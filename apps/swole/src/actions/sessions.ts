'use server'

import { revalidatePath } from 'next/cache'

import {
  completeSession as dbCompleteSession,
  type CompleteSessionArgs,
  startSession as dbStartSession,
  type StartSessionArgs,
} from 'src/db/sessions'
import type { SessionRow } from 'src/db/types'

export async function startSession(
  args: StartSessionArgs,
): Promise<SessionRow> {
  const row = await dbStartSession(args)
  revalidatePath('/')
  revalidatePath(`/session/${row.id}`)
  return row
}

export async function completeSession(
  args: CompleteSessionArgs,
): Promise<SessionRow> {
  const row = await dbCompleteSession(args)
  revalidatePath('/')
  revalidatePath(`/session/${args.sessionId}`)
  return row
}
