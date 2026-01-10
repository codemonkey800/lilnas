import List from 'src/commands/list.js'

export default class DevList extends List {
  static override description = 'List all services in development mode'

  protected override devMode = true
}
