import { getErrorMessage } from '@lilnas/utils/error'
import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  GatewayTimeoutException,
  HttpCode,
  Post,
} from '@nestjs/common'

import { LlmTimeoutError } from 'src/llm/client/default-llm-client'
import {
  PlaygroundModelError,
  PlaygroundService,
} from 'src/playground/playground.service'

import type { PlaygroundChatBody, PlaygroundChatResponse } from './api.types'
import { playgroundChatBodySchema } from './playground.schema'
import { ZodValidationPipe } from './zod-validation.pipe'

@Controller('playground')
export class PlaygroundController {
  constructor(private readonly playground: PlaygroundService) {}

  @Post('chat')
  @HttpCode(200)
  async chat(
    @Body(new ZodValidationPipe(playgroundChatBodySchema))
    body: PlaygroundChatBody,
  ): Promise<PlaygroundChatResponse> {
    try {
      return await this.playground.chat(body)
    } catch (err) {
      if (err instanceof PlaygroundModelError) {
        throw new BadRequestException(err.message)
      }
      if (err instanceof LlmTimeoutError) {
        throw new GatewayTimeoutException(err.message)
      }
      throw new BadGatewayException(getErrorMessage(err))
    }
  }
}
