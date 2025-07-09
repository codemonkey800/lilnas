import * as path from 'path'
import { z } from 'zod'

import { runInteractive } from 'src/utils'

import { down } from './down'
import { up } from './up'

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

  await down({ all, services })
  await up({ services })
}
