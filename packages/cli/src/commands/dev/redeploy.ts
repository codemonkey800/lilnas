import Redeploy from 'src/commands/redeploy.js'
import type { ServiceMode } from 'src/services/discovery.js'

export default class DevRedeploy extends Redeploy {
  static override description =
    'Redeploy dev services by running down followed by up'

  override mode: ServiceMode = 'dev'
}
