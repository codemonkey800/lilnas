import * as path from 'path'
import { z } from 'zod'

import { runInteractive } from 'src/utils'

const RedeployOptionsSchema = z.object({
  all: z.boolean().optional(),
  services: z.string().array().optional(),
  'rebuild-base': z.boolean().optional(),
})

export async function redeploy(options: unknown) {
  const {
    all,
    services,
    'rebuild-base': rebuildBase,
  } = RedeployOptionsSchema.parse(options)

  if (rebuildBase) {
    console.log('Rebuilding base images...')
    const scriptPath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'infra',
      'base-images',
      'build-base-images.sh',
    )
    runInteractive(scriptPath)
  }

  // Docker down with image removal
  const imageType = all ? 'all' : 'local'
  const servicesList = services ? services.join(' ') : ''
  runInteractive(
    `docker-compose -f docker-compose.yml down --rmi ${imageType} -v ${servicesList}`,
  )

  // Docker up
  runInteractive(`docker-compose -f docker-compose.yml up -d ${servicesList}`)
}
