'use server'

import { revalidatePath } from 'next/cache'

import { DataLayerError, type DataLayerErrorKind } from 'src/db/errors'
import {
  completeSession as dbCompleteSession,
  type CompleteSessionArgs,
  startSession as dbStartSession,
  type StartSessionArgs,
} from 'src/db/sessions'
import type { SessionRow } from 'src/db/types'

export type ActionResult<T> =
  | { ok: true; row: T }
  | { ok: false; kind: DataLayerErrorKind; code: string }

export async function startSession(
  args: StartSessionArgs,
): Promise<ActionResult<SessionRow>> {
  try {
    const row = await dbStartSession(args)
    revalidatePath('/')
    revalidatePath(`/session/${row.id}`)
    return { ok: true, row }
  } catch (err) {
    if (err instanceof DataLayerError)
      return { ok: false, kind: err.kind, code: err.constructor.name }
    throw err
  }
}

export async function completeSession(
  args: CompleteSessionArgs,
): Promise<SessionRow> {
  const row = await dbCompleteSession(args)
  revalidatePath('/')
  revalidatePath(`/session/${args.sessionId}`)
  return row
}
