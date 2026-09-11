import { Command } from '@oclif/core'
import * as path from 'path'

import { findMockupProjects, MOCKUPS_GLOB } from '../../utils/mockups'
import { getMonorepoRoot } from '../../utils/paths'

export class MockupsList extends Command {
  static override aliases = ['mockups:ls']

  static override description = 'List the mockup projects in the monorepo'

  static override examples = [
    '<%= config.bin %> mockups list',
    '<%= config.bin %> mockups ls',
  ]

  async run(): Promise<void> {
    const root = getMonorepoRoot()
    const projects = findMockupProjects(root)

    if (projects.length === 0) {
      this.log(`No mockup projects found under ${MOCKUPS_GLOB}`)
      return
    }

    for (const project of projects) {
      this.log(`${project.name}\t${path.relative(root, project.dir)}`)
    }
  }
}
