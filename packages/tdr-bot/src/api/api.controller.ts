import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common'
import { ChannelType, Client } from 'discord.js'
import * as fs from 'fs-extra'
import { ChatModel } from 'openai/resources'
import * as path from 'path'

import { VERSION } from 'src/constants/version'
import { ImageResponse } from 'src/schemas/graph'
import { EquationImageService } from 'src/services/equation-image.service'
import { AppState, StateService } from 'src/state/state.service'
import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'

import type {
  ChannelInfo,
  SendMessageRequest,
  SendMessageResponse,
} from './api.types'
import {
  EditableAppState,
  GraphHistoryFile,
  HealthResponse,
  MessageState,
} from './api.types'

const LOG_DIR = process.env.NODE_ENV === 'development' ? './logs' : '/mnt/logs'

class UpdateStateDto {
  chatModel?: ChatModel
  maxTokens?: number
  prompt?: string
  reasoningModel?: ChatModel
  temperature?: number
}

@Controller()
export class ApiController {
  constructor(
    private readonly state: StateService,
    private readonly equationImage: EquationImageService,
    private readonly client: Client,
  ) {}

  @Get('state')
  async getState(): Promise<EditableAppState> {
    const state = this.state.getState()

    return {
      chatModel: state.chatModel,
      maxTokens: state.maxTokens,
      prompt: state.prompt,
      reasoningModel: state.reasoningModel,
      temperature: state.temperature,
    }
  }

  @Post('state')
  async updateState(@Body() state: UpdateStateDto) {
    const nextState: Partial<AppState> = { ...state }

    // Clear history if prompt is changed
    const prev = this.state.getState()
    if (state.prompt && state.prompt !== prev.prompt) {
      nextState.graphHistory = []
    }

    this.state.setState(nextState)

    return this.state.getState()
  }

  @Get('messages')
  async getMessages(): Promise<MessageState[]> {
    const imagesMap = new Map<string, ImageResponse[]>()
    const state = this.state.getState()

    for (const item of state.graphHistory) {
      if (item.images && item.images.length > 0) {
        const parentId = item.images[0].parentId

        if (parentId) {
          imagesMap.set(parentId, item.images)
        }
      }
    }

    return Promise.all(
      state.graphHistory
        .at(-1)
        ?.messages.filter(m => m.id !== TDR_SYSTEM_PROMPT_ID)
        .map(async message => {
          const id = message.id ?? ''
          const images = imagesMap.get(id) ?? []

          return {
            id: message?.id,
            content: message?.content.toString() ?? '--',
            kwargs: message?.additional_kwargs ?? {},
            type: message?.getType() ?? 'human',
            images,

            ...(images && images.length > 0 ? { images } : {}),
          }
        }) ?? [],
    )
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

  @Get('graph-history/files')
  async getGraphHistoryFiles(): Promise<GraphHistoryFile[]> {
    try {
      const files = await fs.readdir(LOG_DIR)

      // Filter for graph-history files
      const graphHistoryFiles = files.filter(
        file => file.startsWith('graph-history-') && file.endsWith('.jsonl'),
      )

      // Extract indices and sort in reverse order (newest first)
      const historyFiles = graphHistoryFiles
        .map(filename => {
          const match = filename.match(/graph-history-(\d+)\.jsonl/)
          if (!match) return null

          const index = parseInt(match[1], 10)
          return {
            filename,
            index,
            label: `Log File ${index}`,
          }
        })
        .filter((file): file is GraphHistoryFile => file !== null)
        .sort((a, b) => b.index - a.index) // Newest first

      return historyFiles
    } catch {
      // If directory doesn't exist or other errors, return empty array
      return []
    }
  }

  @Get('graph-history/files/:filename')
  async getGraphHistoryMessages(
    @Param('filename') filename: string,
  ): Promise<MessageState[]> {
    // Validate filename to prevent directory traversal
    if (!filename.match(/^graph-history-\d+\.jsonl$/)) {
      throw new BadRequestException('Invalid filename')
    }

    const filePath = path.join(LOG_DIR, filename)

    try {
      const fileExists = await fs.pathExists(filePath)
      if (!fileExists) {
        throw new NotFoundException('History file not found')
      }

      // Read and parse JSONL
      const content = await fs.readFile(filePath, 'utf-8')
      const lines = content.trim().split('\n')

      const messages: MessageState[] = lines
        .filter(line => line.trim().length > 0)
        .map(line => {
          try {
            return JSON.parse(line)
          } catch {
            return null
          }
        })
        .filter((msg): msg is MessageState => msg !== null)

      return messages
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error
      }

      throw new BadRequestException('Failed to read history file')
    }
  }
}
