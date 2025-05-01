import { ServicesOptionSchema } from 'src/utils'

import { down } from './down'
import { up } from './up'

export async function redeploy(options: unknown) {
  const { services } = ServicesOptionSchema.parse(options)

  down({ services })
  up({ services })
}
