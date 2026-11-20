import { Inject, Injectable } from '@nestjs/common'
import { desc, eq } from 'drizzle-orm'

import { type Database, DB } from 'src/db/database'
import { type JobEvent, jobEvents } from 'src/db/schema'

@Injectable()
export class JobEventsRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  async append(
    jobId: string,
    type: string,
    message: string,
  ): Promise<JobEvent> {
    const [row] = await this.db
      .insert(jobEvents)
      .values({ jobId, type, message })
      .returning()
    if (!row) throw new Error('insert into job_events returned no row')
    return row
  }

  /** The last `limit` events of a job, oldest first. */
  async tail(jobId: string, limit: number): Promise<JobEvent[]> {
    const rows = await this.db
      .select()
      .from(jobEvents)
      .where(eq(jobEvents.jobId, jobId))
      .orderBy(desc(jobEvents.id))
      .limit(limit)
    return rows.reverse()
  }
}
