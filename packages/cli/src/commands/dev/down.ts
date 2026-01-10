import Down from 'src/commands/down.js'

export default class DevDown extends Down {
  static override description = 'Bring down services in development mode'

  protected override devMode = true
}
