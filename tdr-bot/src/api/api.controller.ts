import { Controller, Get } from '@nestjs/common'

import { ImageResponse } from 'src/schemas/graph'
import { EquationImageService } from 'src/services/equation-image.service'
import { StateService } from 'src/state/state.service'

import { MessageState } from './api.types'

@Controller()
export class ApiController {
  constructor(
    private readonly state: StateService,
    private readonly equationImage: EquationImageService,
  ) {}

  @Get('messages')
  async getMessages(): Promise<MessageState[]> {
    const equationImagesMap = new Map<string, string>()
    const imagesMap = new Map<string, ImageResponse[]>()
    const state = this.state.getState()

    for (const item of state.graphHistory) {
      if (item.images && item.images.length > 0) {
        const parentId = item.images[0].parentId

        if (parentId) {
          imagesMap.set(parentId, item.images)
        }
      }

      if (item.latex) {
        equationImagesMap.set(item.latexParentId, item.latex)
      }
    }

    return Promise.all(
      state.graphHistory.at(-1)?.messages.map(async (message) => {
        const id = message.id ?? ''

        const equationImageLatex = equationImagesMap.get(id)
        const equationImage =
          await this.equationImage.getImage(equationImageLatex)

        const images = imagesMap.get(id)

        return {
          id: message?.id,
          content: message?.content.toString() ?? '--',
          kwargs: message?.additional_kwargs ?? {},
          type: message?.getType() ?? 'human',

          ...(images && images.length > 0 ? { images } : {}),

          ...(equationImage ? { equationImage } : {}),
        }
      }) ?? [],
    )
  }
}
