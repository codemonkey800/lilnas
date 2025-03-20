import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { LRUCache } from 'lru-cache'
import { nanoid } from 'nanoid'
import { performance } from 'perf_hooks'
import { z } from 'zod'

import { env } from 'src/utils/env'

const EquationAPIResponseSchema = z.object({
  image: z.string(),
})

const EquationAPIErrorSchema = z.object({
  message: z.string(),
  status: z.number(),
})

const EquationAPIResponse = z.union([
  EquationAPIResponseSchema,
  EquationAPIErrorSchema,
])

@Injectable()
export class EquationImageService {
  private logger = new Logger(EquationImageService.name)

  private cache = new LRUCache<string, string>({ max: 100 })

  private async fetchImage(latex: string): Promise<string | undefined> {
    const id = nanoid()

    this.logger.log({ id }, 'Fetching latex image')
    const start = performance.now()

    const response = await axios.post('https://equations.lilnas.io/equations', {
      latex,
      token: env('EQUATIONS_API_KEY'),
    })

    const end = performance.now()
    const duration = end - start

    const data = EquationAPIResponse.parse(response.data)

    if ('image' in data) {
      this.logger.log({ id, duration }, 'Fetched latex image')
      return data.image
    }

    this.logger.error({ id, duration, ...data }, 'Failed to fetch latex image')

    return undefined
  }

  async getImage(
    latex?: string | null | undefined,
  ): Promise<string | undefined> {
    if (!latex) {
      return undefined
    }

    const id = nanoid()

    const cachedValue = this.cache.get(latex)
    if (cachedValue) {
      this.logger.log({ id }, 'Returning cached latex image')
      return cachedValue
    }

    const image = await this.fetchImage(latex)

    if (image) {
      this.logger.log({ id }, 'Caching latex image')
      this.cache.set(latex, image)
    }

    return image
  }
}
