import Up from 'src/commands/up.js'

export default class DevUp extends Up {
  static override description = 'Bring up services in development mode'

  protected override devMode = true
}
