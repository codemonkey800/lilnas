import { env } from '@lilnas/utils/env'
import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { LRUCache } from 'lru-cache'
import { nanoid } from 'nanoid'
import { performance } from 'perf_hooks'
import { z } from 'zod'

import { EnvKey } from 'src/utils/env'

const EquationAPISuccessSchema = z.object({
  bucket: z.string(),
  file: z.string(),
  url: z.string(),
})

type EquationAPISuccess = z.infer<typeof EquationAPISuccessSchema>

const EquationAPIFailureSchema = z.object({
  message: z.string(),
  status: z.number(),
})

const EquationAPIResponseSchema = z.union([
  EquationAPISuccessSchema,
  EquationAPIFailureSchema,
])

export interface EquationImageData extends EquationAPISuccess {
  url: string
}

@Injectable()
export class EquationImageService {
  private logger = new Logger(EquationImageService.name)

  private cache = new LRUCache<string, EquationImageData>({ max: 100 })

  private async fetchImage(
    latex: string,
  ): Promise<EquationAPISuccess | undefined> {
    const id = nanoid()

    this.logger.log({ id }, 'Fetching latex image')
    const start = performance.now()

    const url = `${env<EnvKey>('EQUATIONS_URL')}/equations`
    const response = await axios.post(url, {
      latex,
      token: env<EnvKey>('EQUATIONS_API_KEY'),
    })

    const end = performance.now()
    const duration = end - start

    const data = EquationAPIResponseSchema.parse(response.data)

    if ('bucket' in data) {
      this.logger.log({ id, duration, ...data }, 'Fetched latex image')
      return data
    }

    this.logger.error({ id, duration, ...data }, 'Failed to fetch latex image')

    return undefined
  }

  async getImage(
    latex?: string | null | undefined,
  ): Promise<EquationImageData | undefined> {
    if (!latex) {
      return undefined
    }

    const id = nanoid()

    const cachedValue = this.cache.get(latex)
    if (cachedValue) {
      this.logger.log({ id, ...cachedValue }, 'Returning cached latex image')
      return cachedValue
    }

    const image = await this.fetchImage(latex)

    if (image) {
      this.logger.log({ id, ...image }, 'Caching latex image')
      this.cache.set(latex, image)
    }

    return image
  }
}
