import { z } from 'zod'

import { runInteractive, ServicesOptionSchema } from 'src/utils'

const DownOptionsSchema = z
  .object({ 
    all: z.union([z.boolean(), z.literal('true'), z.literal('false')])
      .transform(val => val === 'true' || val === true)
      .optional() 
  })
  .merge(ServicesOptionSchema)

export async function down(options: unknown) {
  const { all, services } = DownOptionsSchema.parse(options)
  const imageType = all ? 'all' : 'local'

  runInteractive(
    `docker-compose down --rmi ${imageType} -v ${services.join(' ')}`,
  )
}
