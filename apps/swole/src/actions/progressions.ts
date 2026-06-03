'use server'

import { revalidatePath } from 'next/cache'

import {
  commitProgressionDecision as dbCommitProgressionDecision,
  type CommitProgressionDecisionArgs,
} from 'src/db/progressions'
import type { ProgressionRow } from 'src/db/types'

export async function commitProgressionDecision(
  args: CommitProgressionDecisionArgs,
): Promise<ProgressionRow> {
  const row = await dbCommitProgressionDecision(args)
  revalidatePath(`/stats/${args.exerciseId}`)
  revalidatePath(`/session/${args.sessionId}`)
  return row
}
