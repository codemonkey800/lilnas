import { z } from 'zod'

import { down } from './down'
import { up } from './up'

const RedeployOptionsSchema = z.object({
  all: z.boolean().optional(),
  services: z.string().array().optional(),
})

export async function redeploy(options: unknown) {
  const { all, services } = RedeployOptionsSchema.parse(options)

  down({ all, services })
  up({ services })
}
