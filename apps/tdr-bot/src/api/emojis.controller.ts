import { getErrorMessage } from '@lilnas/utils/error'
import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common'

import type { EmojiRow } from 'src/db/schema'
import { EmojiDictionaryRepository } from 'src/emojis/emoji-dictionary.repository'
import { EmojiDictionaryService } from 'src/emojis/emoji-dictionary.service'
import {
  EmojiDeletedError,
  EmojiNotFoundError,
  EmojiSyncService,
} from 'src/emojis/emoji-sync.service'

import type { EmojiListResponse, EmojiView, UpdateEmojiBody } from './api.types'
import { toEmojiView } from './emoji-views'
import { updateEmojiBodySchema } from './emojis.schema'
import { ZodValidationPipe } from './zod-validation.pipe'

/** Live rows first, then deleted ones, each by name (case-insensitive). */
function compareRows(a: EmojiRow, b: EmojiRow): number {
  const deleted = Number(a.deletedAt !== null) - Number(b.deletedAt !== null)
  if (deleted !== 0) return deleted
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

@Controller('emojis')
export class EmojisController {
  private readonly logger = new Logger(EmojisController.name)

  constructor(
    private readonly repo: EmojiDictionaryRepository,
    private readonly dictionary: EmojiDictionaryService,
    private readonly sync: EmojiSyncService,
  ) {}

  @Get()
  async list(): Promise<EmojiListResponse> {
    const rows = await this.repo.listAll()
    return {
      emojis: [...rows].sort(compareRows).map(toEmojiView),
      reconcile: this.sync.status(),
    }
  }

  @Post('reconcile')
  @HttpCode(202)
  reconcile(): { started: boolean } {
    if (this.sync.status().running) return { started: false }

    this.sync.reconcile('admin').catch(err => {
      this.logger.error(
        { error: getErrorMessage(err) },
        'Admin emoji reconcile failed',
      )
    })
    return { started: true }
  }

  @Post('redescribe-all')
  @HttpCode(202)
  redescribeAll(): { started: boolean } {
    if (this.sync.status().running) return { started: false }

    this.sync.redescribeAll().catch(err => {
      this.logger.error(
        { error: getErrorMessage(err) },
        'Admin emoji re-describe-all failed',
      )
    })
    return { started: true }
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateEmojiBodySchema)) body: UpdateEmojiBody,
  ): Promise<EmojiView> {
    const row = await this.repo.setDescription(id, {
      description: body.description,
      source: 'manual',
      model: null,
    })
    if (!row) throw new NotFoundException('Emoji not found')

    await this.dictionary.refresh()
    return toEmojiView(row)
  }

  @Post(':id/redescribe')
  @HttpCode(200)
  async redescribe(@Param('id') id: string): Promise<EmojiView> {
    try {
      return toEmojiView(await this.sync.redescribe(id))
    } catch (err) {
      if (err instanceof EmojiNotFoundError) {
        throw new NotFoundException(err.message)
      }
      if (err instanceof EmojiDeletedError) {
        throw new ConflictException(err.message)
      }
      throw new BadGatewayException(getErrorMessage(err))
    }
  }
}
