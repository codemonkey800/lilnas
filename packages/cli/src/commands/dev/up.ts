import BaseComposeCommand from 'src/core/base-compose.js'
import type { ServiceMode } from 'src/services/discovery.js'

export default class DevUp extends BaseComposeCommand {
  static override description =
    'Bring up dev Docker Compose services in detached mode'

  override composeArgs = ['up', '-d']
  override mode: ServiceMode = 'dev'
  protected override needsImageCheck = true
}
