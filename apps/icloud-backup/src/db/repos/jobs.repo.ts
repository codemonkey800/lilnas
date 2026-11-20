import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, notInArray } from 'drizzle-orm'

import { type Database, DB } from 'src/db/database'
import { type Job, jobs } from 'src/db/schema'
import {
  type BackupState,
  type ErrorCode,
  TERMINAL_STATES,
} from 'src/shared/contract'

/** `errorDetail` is cut to this many characters before it is stored. */
export const MAX_ERROR_DETAIL = 2000

export type JobKind = 'first_backup' | 'sync'

export interface CreateJobInput {
  accountId: string
  kind: JobKind
  state: BackupState
}

export type JobPatch = Partial<
  Omit<Job, 'id' | 'accountId' | 'kind' | 'startedAt' | 'updatedAt'>
>

function clampDetail<T extends { errorDetail?: string | null }>(patch: T): T {
  const detail = patch.errorDetail
  if (typeof detail === 'string' && detail.length > MAX_ERROR_DETAIL) {
    return { ...patch, errorDetail: detail.slice(0, MAX_ERROR_DETAIL) }
  }
  return patch
}

@Injectable()
export class JobsRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Throws on a unique violation when the account already has a live job. */
  async create(input: CreateJobInput): Promise<Job> {
    const [row] = await this.db.insert(jobs).values(input).returning()
    if (!row) throw new Error('insert into jobs returned no row')
    return row
  }

  async findById(id: string): Promise<Job | null> {
    const [row] = await this.db
      .select()
      .from(jobs)
      .where(eq(jobs.id, id))
      .limit(1)
    return row ?? null
  }

  /** The account's non-terminal job, if any. */
  async findActiveForAccount(accountId: string): Promise<Job | null> {
    const [row] = await this.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.accountId, accountId),
          notInArray(jobs.state, [...TERMINAL_STATES]),
        ),
      )
      .limit(1)
    return row ?? null
  }

  async findLatestForAccount(accountId: string): Promise<Job | null> {
    const [row] = await this.db
      .select()
      .from(jobs)
      .where(eq(jobs.accountId, accountId))
      .orderBy(desc(jobs.startedAt), desc(jobs.id))
      .limit(1)
    return row ?? null
  }

  /** Every non-terminal job across all accounts. */
  findNonTerminal(): Promise<Job[]> {
    return this.db
      .select()
      .from(jobs)
      .where(notInArray(jobs.state, [...TERMINAL_STATES]))
  }

  async update(id: string, patch: JobPatch): Promise<Job | null> {
    const [row] = await this.db
      .update(jobs)
      .set({ ...clampDetail(patch), updatedAt: new Date() })
      .where(eq(jobs.id, id))
      .returning()
    return row ?? null
  }

  /** Moves the job to a terminal state and stamps `finishedAt`. */
  finish(
    id: string,
    state: BackupState,
    errorCode?: ErrorCode,
    errorDetail?: string,
  ): Promise<Job | null> {
    return this.update(id, {
      state,
      finishedAt: new Date(),
      retryAt: null,
      currentFile: null,
      errorCode: errorCode ?? null,
      errorDetail: errorDetail ?? null,
    })
  }
}
