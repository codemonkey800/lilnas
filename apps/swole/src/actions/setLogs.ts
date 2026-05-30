'use server'

import { revalidatePath } from 'next/cache'

import { DataLayerError, type DataLayerErrorKind } from 'src/db/errors'
import {
  appendSetLog as dbAppendSetLog,
  type AppendSetLogArgs,
  undoLastSetLog as dbUndoLastSetLog,
  type UndoLastSetLogArgs,
} from 'src/db/setLogs'
import type { SetLogRow } from 'src/db/types'

export type AppendSetLogResult =
  | { ok: true; row: SetLogRow }
  | { ok: false; kind: DataLayerErrorKind; code: string }

export type UndoSetLogResult =
  | { ok: true }
  | { ok: false; kind: DataLayerErrorKind; code: string }

export async function appendSetLog(
  args: AppendSetLogArgs,
): Promise<AppendSetLogResult> {
  try {
    const row = await dbAppendSetLog(args)
    revalidatePath(`/session/${args.sessionId}`)
    return { ok: true, row }
  } catch (err) {
    if (err instanceof DataLayerError)
      return { ok: false, kind: err.kind, code: err.constructor.name }
    throw err
  }
}

export async function undoLastSetLog(
  args: UndoLastSetLogArgs,
): Promise<UndoSetLogResult> {
  try {
    await dbUndoLastSetLog(args)
    revalidatePath(`/session/${args.sessionId}`)
    return { ok: true }
  } catch (err) {
    if (err instanceof DataLayerError)
      return { ok: false, kind: err.kind, code: err.constructor.name }
    throw err
  }
}
