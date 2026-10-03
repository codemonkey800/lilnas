import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common'
import { ChannelType, Client } from 'discord.js'

import { VERSION } from 'src/constants/version'
import { ModelSpec } from 'src/llm/models/catalog'
import { ModelRegistry } from 'src/llm/models/model-registry'
import { MODEL_ROLES, ModelRole } from 'src/llm/models/roles'
import type { SettingsPatch } from 'src/llm/settings/settings.schema'
import { SettingsPatchSchema } from 'src/llm/settings/settings.schema'
import {
  SettingsService,
  SettingsValidationError,
} from 'src/llm/settings/settings.service'
import { LLMOrchestrationService } from 'src/messages/llm/llm-orchestration.service'
import { EquationImageService } from 'src/services/equation-image.service'

import type {
  ChannelInfo,
  SendMessageRequest,
  SendMessageResponse,
} from './api.types'
import {
  ConversationMessage,
  HealthResponse,
  SettingsResponse,
} from './api.types'
import { toConversationMessages } from './conversation-messages'
import { ZodValidationPipe } from './zod-validation.pipe'

function isModelRole(value: string): value is ModelRole {
  return (MODEL_ROLES as readonly string[]).includes(value)
}

function toBadRequest(error: unknown): unknown {
  if (error instanceof SettingsValidationError) {
    return new BadRequestException({
      message: error.message,
      issues: error.issues,
    })
  }

  return error
}

@Controller()
export class ApiController {
  constructor(
    private readonly llm: LLMOrchestrationService,
    private readonly settings: SettingsService,
    private readonly registry: ModelRegistry,
    private readonly equationImage: EquationImageService,
    private readonly client: Client,
  ) {}

  private settingsResponse(): SettingsResponse {
    return {
      ...this.settings.get(),
      updatedAt: this.settings.getUpdatedAt().toISOString(),
    }
  }

  @Get('settings')
  async getSettings(): Promise<SettingsResponse> {
    return this.settingsResponse()
  }

  @Put('settings')
  async updateSettings(
    @Body(new ZodValidationPipe(SettingsPatchSchema)) patch: SettingsPatch,
  ): Promise<SettingsResponse> {
    try {
      await this.settings.update(patch)
    } catch (error) {
      throw toBadRequest(error)
    }

    return this.settingsResponse()
  }

  @Post('settings/reset')
  async resetSettings(): Promise<SettingsResponse> {
    await this.settings.reset()

    return this.settingsResponse()
  }

  @Get('models')
  async getModels(@Query('role') role?: string): Promise<ModelSpec[]> {
    if (role !== undefined && !isModelRole(role)) {
      throw new BadRequestException(
        `Invalid role "${role}"; expected one of ${MODEL_ROLES.join(', ')}`,
      )
    }

    return this.registry.list(role)
  }

  @Get('conversations/:channelId')
  async getConversation(
    @Param('channelId') channelId: string,
  ): Promise<ConversationMessage[]> {
    const messages = await this.llm.getThreadMessages(channelId)

    return toConversationMessages(messages)
  }

  @Get('health')
  async getHealth(): Promise<HealthResponse> {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      version: VERSION,
    }
  }

  @Get('channels')
  async getChannels(): Promise<ChannelInfo[]> {
    const channels: ChannelInfo[] = []

    this.client.guilds.cache.forEach(guild => {
      guild.channels.cache.forEach(channel => {
        if (
          channel.type === ChannelType.GuildText ||
          channel.type === ChannelType.GuildAnnouncement
        ) {
          channels.push({
            id: channel.id,
            name: channel.name,
            type:
              channel.type === ChannelType.GuildText ? 'text' : 'announcement',
          })
        }
      })
    })

    return channels.sort((a, b) => a.name.localeCompare(b.name))
  }

  @Post('channels/:channelId/message')
  async sendMessage(
    @Param('channelId') channelId: string,
    @Body() body: SendMessageRequest,
  ): Promise<SendMessageResponse> {
    const { content } = body

    if (!content || content.trim().length === 0) {
      throw new BadRequestException('Message content cannot be empty')
    }

    if (content.length > 2000) {
      throw new BadRequestException(
        'Message content exceeds Discord limit of 2000 characters',
      )
    }

    try {
      const channel = await this.client.channels.fetch(channelId)

      if (!channel) {
        throw new NotFoundException(`Channel with ID ${channelId} not found`)
      }

      if (!channel.isTextBased()) {
        throw new BadRequestException('Channel is not a text-based channel')
      }

      if ('send' in channel) {
        await channel.send(content)
      } else {
        throw new BadRequestException(
          'Channel does not support sending messages',
        )
      }

      return {
        success: true,
        message: 'Message sent successfully',
        sentAt: new Date().toISOString(),
      }
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error
      }

      throw new BadRequestException(
        `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }
}
