import BaseRunCommand from 'src/core/base-run.js'
import type { ServiceMode } from 'src/services/discovery.js'

export default class Run extends BaseRunCommand {
  static override description =
    'Run a one-off service container and remove it after exit'

  override mode: ServiceMode = 'prod'
}
