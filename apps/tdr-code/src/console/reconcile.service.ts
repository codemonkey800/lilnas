import fs from 'node:fs'

import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'

import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { narrowTurnContentPayload } from 'src/db/schema'
import { getSessionById } from 'src/db/sessions.repo'
import { listBlocksByTurns } from 'src/db/turn-content.repo'
import { listTurnsBySession } from 'src/db/turns.repo'

import { jsonlPath } from './jsonl-locator'
import type {
  JsonlStatusResponseDto,
  ReconcileResponseDto,
} from './reconcile.dto'

// Bounded read: skip files larger than this.
const MAX_JSONL_BYTES = 10 * 1024 * 1024 // 10 MiB

// Zod schema for a JSONL record — we only care about a few fields.
const JsonlRecordSchema = z.object({
  type: z.string().optional(),
  role: z.string().optional(),
  content: z.unknown().optional(),
  message: z.unknown().optional(),
})

@Injectable()
export class ReconcileService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly logger: PinoLogger,
  ) {}

  getJsonlStatus(sessionId: number): JsonlStatusResponseDto {
    const session = getSessionById(this.db, sessionId)
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`)

    const { acpSessionId } = session
    if (!acpSessionId) {
      return { acpSessionId: null, exists: false, reason: 'no-acp-id' }
    }

    const located = jsonlPath(session.cwd, acpSessionId)
    if (!located.ok) {
      return {
        acpSessionId,
        exists: false,
        reason: located.reason,
      }
    }

    const exists = fs.existsSync(located.resolvedPath)
    // Never include the path in the response — echoing it leaks the home dir layout.
    return { acpSessionId, exists }
  }

  reconcile(sessionId: number): ReconcileResponseDto {
    const session = getSessionById(this.db, sessionId)
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`)

    const { acpSessionId } = session
    if (!acpSessionId) {
      return { verdict: 'cannot-reconcile', reason: 'no-acp-id' }
    }

    const located = jsonlPath(session.cwd, acpSessionId)
    if (!located.ok) {
      return { verdict: 'cannot-reconcile', reason: located.reason }
    }

    const filePath = located.resolvedPath
    if (!fs.existsSync(filePath)) {
      return { verdict: 'cannot-reconcile', reason: 'file-missing' }
    }

    // Size guard before reading.
    let stat: fs.Stats
    try {
      stat = fs.statSync(filePath)
    } catch (err) {
      this.logger.error({ err, sessionId }, 'reconcile: stat failed')
      return { verdict: 'cannot-reconcile', reason: 'parse-error' }
    }

    let content: string
    let cappedAt: number | undefined
    if (stat.size > MAX_JSONL_BYTES) {
      cappedAt = MAX_JSONL_BYTES
      const buf = Buffer.alloc(MAX_JSONL_BYTES)
      let fd: number | undefined
      try {
        fd = fs.openSync(filePath, 'r')
        const bytesRead = fs.readSync(fd, buf, 0, MAX_JSONL_BYTES, 0)
        // Trim to last newline to avoid a truncated JSON line.
        const raw = buf.subarray(0, bytesRead).toString('utf8')
        const lastNl = raw.lastIndexOf('\n')
        content = lastNl >= 0 ? raw.slice(0, lastNl + 1) : raw
      } catch (err) {
        this.logger.error({ err, sessionId }, 'reconcile: read failed')
        return { verdict: 'cannot-reconcile', reason: 'parse-error' }
      } finally {
        if (fd !== undefined) {
          try {
            fs.closeSync(fd)
          } catch {
            // already closed or never opened cleanly
          }
        }
      }
    } else {
      try {
        content = fs.readFileSync(filePath, 'utf8')
      } catch (err) {
        this.logger.error({ err, sessionId }, 'reconcile: readFile failed')
        return { verdict: 'cannot-reconcile', reason: 'parse-error' }
      }
    }

    // Parse JSONL line-by-line, skip malformed lines.
    const jsonlBlocks: Array<{ kind: string; text?: string; title?: string }> =
      []
    let skippedJsonlLines = 0
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        skippedJsonlLines++
        continue
      }
      const record = JsonlRecordSchema.safeParse(parsed)
      if (!record.success) {
        skippedJsonlLines++
        continue
      }
      const r = record.data
      // Claude nests role/content under a `message` object; fall back to top-level
      // for older or non-message records.
      const msg =
        r.message && typeof r.message === 'object'
          ? (r.message as { role?: string; content?: unknown })
          : undefined
      const role = msg?.role ?? r.role
      const rawContent = msg?.content ?? r.content
      if (role === 'user' && rawContent) {
        const text =
          typeof rawContent === 'string'
            ? rawContent
            : JSON.stringify(rawContent)
        jsonlBlocks.push({ kind: 'prompt', text })
      } else if (role === 'assistant' && rawContent) {
        // Assistant content is typically an array of typed blocks; extract text parts.
        let text: string
        if (typeof rawContent === 'string') {
          text = rawContent
        } else if (Array.isArray(rawContent)) {
          const parts = rawContent
            .filter(
              (b): b is { type: string; text: string } =>
                typeof b === 'object' &&
                b !== null &&
                (b as Record<string, unknown>).type === 'text' &&
                typeof (b as Record<string, unknown>).text === 'string',
            )
            .map(b => b.text)
          text = parts.length > 0 ? parts.join('') : JSON.stringify(rawContent)
        } else {
          text = JSON.stringify(rawContent)
        }
        jsonlBlocks.push({ kind: 'agent_text', text })
      } else if (r.type) {
        jsonlBlocks.push({ kind: r.type })
      }
    }

    // Load persisted blocks — separate DB read, not holding snapshot across FS I/O.
    const turns = listTurnsBySession(this.db, sessionId)
    const turnIds = turns.map(t => t.id)
    const dbBlockRows = listBlocksByTurns(this.db, turnIds)
    const dbBlocks = dbBlockRows
      .map(b => {
        const n = narrowTurnContentPayload(b.payload, b.kind)
        if (!n) return null
        return {
          kind: n.kind,
          text: 'text' in n ? n.text : undefined,
          title: 'title' in n ? (n as { title?: string }).title : undefined,
        }
      })
      .filter((b): b is NonNullable<typeof b> => b !== null)

    // Simple positional diff.
    const maxLen = Math.max(jsonlBlocks.length, dbBlocks.length)
    let matched = 0
    const missingInDb: typeof jsonlBlocks = []
    const extraInDb: typeof dbBlocks = []
    const mismatched: Array<{
      kind: string
      jsonlText?: string
      dbText?: string
    }> = []

    for (let i = 0; i < maxLen; i++) {
      const jBlock = jsonlBlocks[i]
      const dBlock = dbBlocks[i]
      if (!jBlock && dBlock) {
        extraInDb.push(dBlock)
      } else if (jBlock && !dBlock) {
        missingInDb.push(jBlock)
      } else if (jBlock && dBlock) {
        if (jBlock.kind === dBlock.kind && jBlock.text === dBlock.text) {
          matched++
        } else {
          mismatched.push({
            kind: jBlock.kind,
            jsonlText: jBlock.text,
            dbText: dBlock.text,
          })
        }
      }
    }

    return {
      verdict: 'reconciled',
      matched,
      missingInDb,
      extraInDb,
      mismatched,
      skippedJsonlLines,
      ...(cappedAt !== undefined ? { cappedAt } : {}),
    }
  }
}
