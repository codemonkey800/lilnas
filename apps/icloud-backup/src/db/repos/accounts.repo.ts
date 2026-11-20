import { Inject, Injectable } from '@nestjs/common'
import { asc, eq, sql } from 'drizzle-orm'

import { type Database, DB } from 'src/db/database'
import { type Account, accounts } from 'src/db/schema'

export interface CreateAccountInput {
  lilnasUserId: string
  lilnasEmail: string
  /** Base slug; `-2`, `-3`, … is appended when another account has it. */
  slug: string
}

export interface ImmichLink {
  userId: string
  libraryId: string
  email: string
  createdByUs: boolean
}

@Injectable()
export class AccountsRepo {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findByLilnasUserId(lilnasUserId: string): Promise<Account | null> {
    const [row] = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.lilnasUserId, lilnasUserId))
      .limit(1)
    return row ?? null
  }

  async findById(id: string): Promise<Account | null> {
    const [row] = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1)
    return row ?? null
  }

  list(): Promise<Account[]> {
    return this.db.select().from(accounts).orderBy(asc(accounts.createdAt))
  }

  async slugExists(slug: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.slug, slug))
      .limit(1)
    return row !== undefined
  }

  /**
   * Inserts the account under the first free slug of `slug`, `slug-2`,
   * `slug-3`, …. Only accounts count as a collision; a folder of that name on
   * disk does not. The insert itself skips a taken slug, so two concurrent
   * creates cannot both win it.
   */
  async create(input: CreateAccountInput): Promise<Account> {
    for (let n = 1; ; n++) {
      const slug = n === 1 ? input.slug : `${input.slug}-${n}`
      const [row] = await this.db
        .insert(accounts)
        .values({
          lilnasUserId: input.lilnasUserId,
          lilnasEmail: input.lilnasEmail,
          slug,
        })
        .onConflictDoNothing({ target: accounts.slug })
        .returning()
      if (row) return row
    }
  }

  /** Throws on a unique violation when another account has this Apple ID. */
  async setAppleId(id: string, appleId: string): Promise<void> {
    await this.db
      .update(accounts)
      .set({ appleId, updatedAt: new Date() })
      .where(eq(accounts.id, id))
  }

  async setImmich(id: string, link: ImmichLink): Promise<void> {
    await this.db
      .update(accounts)
      .set({
        immichUserId: link.userId,
        immichLibraryId: link.libraryId,
        immichEmail: link.email,
        immichCreatedByUs: link.createdByUs,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, id))
  }

  /** Adds to the running totals and stamps `lastBackupAt`. */
  async addTotals(id: string, items: number, bytes: number): Promise<void> {
    await this.db
      .update(accounts)
      .set({
        totalItems: sql`${accounts.totalItems} + ${items}`,
        totalBytes: sql`${accounts.totalBytes} + ${bytes}`,
        lastBackupAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, id))
  }
}
