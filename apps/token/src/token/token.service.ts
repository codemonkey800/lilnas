import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { and, count, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import { DrizzleService } from 'src/db/drizzle.service'
import { type Token, tokens } from 'src/db/schema'

import { CreateTokenDto } from './token.dto'
import { TokenMetricsService } from './token-metrics.service'

const BCRYPT_ROUNDS = 10
const TOKEN_PREFIX = 'tok_'
const TOKEN_RANDOM_LENGTH = 32
const TOKEN_DISPLAY_PREFIX_LENGTH = 12

export interface CreatedTokenResponse {
  id: string
  appSlug: string
  name: string
  description: string | null
  tokenPrefix: string
  createdAt: Date
  /** Full token value -- only returned once at creation time */
  value: string
}

export interface TokenSummary {
  appSlug: string
  tokenCount: number
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name)

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly metrics: TokenMetricsService,
  ) {}

  private get db() {
    return this.drizzle.db
  }

  async createToken(
    appSlug: string,
    dto: CreateTokenDto,
  ): Promise<CreatedTokenResponse> {
    const value = TOKEN_PREFIX + nanoid(TOKEN_RANDOM_LENGTH)
    const tokenHash = await bcrypt.hash(value, BCRYPT_ROUNDS)
    const tokenPrefix = value.slice(0, TOKEN_DISPLAY_PREFIX_LENGTH)
    const id = nanoid()

    const [created] = await this.db
      .insert(tokens)
      .values({
        id,
        appSlug,
        name: dto.name,
        description: dto.description ?? null,
        tokenHash,
        tokenPrefix,
      })
      .returning()

    if (!created) {
      throw new UnprocessableEntityException('Failed to create token')
    }

    this.logger.log({ appSlug, tokenId: id, tokenPrefix }, 'Created token')
    this.metrics.tokenCreated(appSlug)

    return {
      id: created.id,
      appSlug: created.appSlug,
      name: created.name,
      description: created.description,
      tokenPrefix: created.tokenPrefix,
      createdAt: created.createdAt,
      value,
    }
  }

  async listTokens(appSlug: string): Promise<Token[]> {
    return this.db
      .select()
      .from(tokens)
      .where(eq(tokens.appSlug, appSlug))
      .orderBy(tokens.createdAt)
  }

  async getToken(appSlug: string, id: string): Promise<Token> {
    const [token] = await this.db
      .select()
      .from(tokens)
      .where(and(eq(tokens.appSlug, appSlug), eq(tokens.id, id)))

    if (!token) {
      throw new NotFoundException(`Token ${id} not found for app ${appSlug}`)
    }

    return token
  }

  async deleteToken(appSlug: string, id: string): Promise<void> {
    const result = await this.db
      .delete(tokens)
      .where(and(eq(tokens.appSlug, appSlug), eq(tokens.id, id)))
      .returning({ id: tokens.id })

    if (result.length === 0) {
      throw new NotFoundException(`Token ${id} not found for app ${appSlug}`)
    }

    this.logger.log({ appSlug, tokenId: id }, 'Deleted token')
    this.metrics.tokenDeleted(appSlug)
  }

  async getTokenCountsByApp(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ appSlug: tokens.appSlug, count: count() })
      .from(tokens)
      .groupBy(tokens.appSlug)

    return Object.fromEntries(rows.map(r => [r.appSlug, r.count]))
  }

  async validateToken(appSlug: string, value: string): Promise<boolean> {
    const start = Date.now()
    const tokenPrefix = value.slice(0, TOKEN_DISPLAY_PREFIX_LENGTH)
    try {
      const candidates = await this.db
        .select({ tokenHash: tokens.tokenHash })
        .from(tokens)
        .where(
          and(eq(tokens.appSlug, appSlug), eq(tokens.tokenPrefix, tokenPrefix)),
        )

      if (candidates.length === 0) {
        const durationMs = Date.now() - start
        this.metrics.tokenValidated(appSlug, 'invalid')
        this.metrics.observeValidationDuration(appSlug, durationMs)
        this.logger.log(
          { appSlug, tokenPrefix, valid: false, durationMs },
          'Token validation result',
        )
        return false
      }

      for (const candidate of candidates) {
        if (await bcrypt.compare(value, candidate.tokenHash)) {
          const durationMs = Date.now() - start
          this.metrics.tokenValidated(appSlug, 'valid')
          this.metrics.observeValidationDuration(appSlug, durationMs)
          this.logger.log(
            { appSlug, tokenPrefix, valid: true, durationMs },
            'Token validation result',
          )
          return true
        }
      }

      const durationMs = Date.now() - start
      this.metrics.tokenValidated(appSlug, 'invalid')
      this.metrics.observeValidationDuration(appSlug, durationMs)
      this.logger.log(
        { appSlug, tokenPrefix, valid: false, durationMs },
        'Token validation result',
      )
      return false
    } catch (err) {
      const durationMs = Date.now() - start
      this.metrics.tokenValidated(appSlug, 'error')
      this.metrics.observeValidationDuration(appSlug, durationMs)
      this.logger.error(
        { err, appSlug, tokenPrefix, durationMs },
        'Error validating token',
      )
      return false
    }
  }
}
