'use server'

import { revalidatePath } from 'next/cache'

import {
  DataLayerError,
  type DataLayerErrorKind,
  isSqliteError,
  SessionHasProgression,
} from 'src/db/errors'
import {
  completeSession as dbCompleteSession,
  type CompleteSessionArgs,
  deleteSession as dbDeleteSession,
  type DeleteSessionArgs,
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
): Promise<ActionResult<SessionRow>> {
  try {
    const row = await dbCompleteSession(args)
    revalidatePath('/')
    revalidatePath(`/session/${args.sessionId}`)
    return { ok: true, row }
  } catch (err) {
    if (err instanceof DataLayerError)
      return { ok: false, kind: err.kind, code: err.constructor.name }
    throw err
  }
}

export async function deleteSession(
  args: DeleteSessionArgs,
): Promise<ActionResult<undefined>> {
  try {
    await dbDeleteSession(args)
    revalidatePath('/')
    revalidatePath('/stats')
    return { ok: true, row: undefined }
  } catch (err) {
    if (err instanceof DataLayerError)
      return { ok: false, kind: err.kind, code: err.constructor.name }
    // Defensive: map an unexpected FK constraint violation to a typed error so
    // a future guard/FK divergence surfaces as a toast rather than a 500.
    // Unreachable today per U3's load-bearing invariant.
    if (isSqliteError(err, 'SQLITE_CONSTRAINT_FOREIGNKEY'))
      return {
        ok: false,
        kind: 'forbidden_transition',
        code: new SessionHasProgression(args.sessionId).constructor.name,
      }
    throw err
  }
}
