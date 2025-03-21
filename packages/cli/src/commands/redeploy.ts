import { down } from './down'
import { up } from './up'

export async function redeploy(services: unknown) {
  down(services)
  up(services)
}
