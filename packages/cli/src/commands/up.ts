import BaseComposeCommand from 'src/core/base-compose.js'
import type { ServiceMode } from 'src/services/discovery.js'

export default class Up extends BaseComposeCommand {
  static override description =
    'Bring up Docker Compose services with docker-compose up -d'

  override composeArgs = ['up', '-d']
  override mode: ServiceMode = 'prod'
  protected override needsImageCheck = true
}
