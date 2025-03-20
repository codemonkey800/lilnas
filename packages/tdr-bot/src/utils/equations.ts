import axios from 'axios'
import { z } from 'zod'

import { env } from './env'

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

export async function getEquationImage(
  latex?: string | null | undefined,
): Promise<string | undefined> {
  if (!latex) {
    return undefined
  }

  const response = await axios.post('https://equations.lilnas.io/equations', {
    latex,
    token: env('EQUATIONS_API_KEY'),
  })

  const data = EquationAPIResponse.parse(response.data)

  if ('image' in data) {
    return data.image
  }

  return undefined
}
