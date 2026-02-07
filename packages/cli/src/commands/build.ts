import BaseComposeCommand from 'src/core/base-compose.js'
import type { ServiceMode } from 'src/services/discovery.js'

export default class Build extends BaseComposeCommand {
  static override description =
    'Build Docker images for services with docker-compose build'

  override composeArgs = ['build']
  override mode: ServiceMode = 'prod'
}
