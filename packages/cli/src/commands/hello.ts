import { Command } from '@oclif/core'

export default class Hello extends Command {
  static override description = 'Say hello world'

  async run(): Promise<void> {
    await this.parse(Hello)
    this.log('Hello, World!')
  }
}
