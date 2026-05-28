'use server'

import { revalidatePath } from 'next/cache'

import {
  appendSetLog as dbAppendSetLog,
  type AppendSetLogArgs,
  undoLastSetLog as dbUndoLastSetLog,
  type UndoLastSetLogArgs,
} from 'src/db/setLogs'
import type { SetLogRow } from 'src/db/types'

export async function appendSetLog(args: AppendSetLogArgs): Promise<SetLogRow> {
  const row = await dbAppendSetLog(args)
  revalidatePath(`/session/${args.sessionId}`)
  return row
}

export async function undoLastSetLog(args: UndoLastSetLogArgs): Promise<void> {
  await dbUndoLastSetLog(args)
  revalidatePath(`/session/${args.sessionId}`)
}
