import { Body, Controller, Get, Post } from '@nestjs/common'
import { ChatModel } from 'openai/resources'

import { ImageResponse } from 'src/schemas/graph'
import { EquationImageService } from 'src/services/equation-image.service'
import { AppState, StateService } from 'src/state/state.service'

import { EditableAppState, MessageState } from './api.types'

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
      state.graphHistory.at(-1)?.messages.map(async message => {
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
}
