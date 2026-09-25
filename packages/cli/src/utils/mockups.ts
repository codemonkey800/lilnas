import * as fs from 'fs'
import * as path from 'path'

import { getMonorepoRoot } from './paths'

/**
 * A mockup project: a `docs/features/<feature>/designs` package whose Pug
 * sources compile to the self-contained `*.html` files committed beside them.
 */
export interface MockupProject {
  /** The feature name — `download` for docs/features/download/designs. */
  name: string
  /** Absolute path to the designs package. */
  dir: string
}

const FEATURES_DIR = path.join('docs', 'features')
const DESIGNS_DIR = 'designs'

/** The glob these projects live at, for error messages. */
export const MOCKUPS_GLOB = `${FEATURES_DIR}/*/${DESIGNS_DIR}`

/**
 * Where a project of the given feature name lives — the one place that knows
 * the convention, so scaffolding and discovery can't drift apart.
 */
export function mockupProjectDir(root: string, feature: string): string {
  return path.join(root, FEATURES_DIR, feature, DESIGNS_DIR)
}

/**
 * Every mockup project in the monorepo, sorted by feature name. A designs
 * directory only counts once it has pages to build, so a feature that has a
 * designs folder for other reasons is skipped rather than failing the build.
 */
export function findMockupProjects(root = getMonorepoRoot()): MockupProject[] {
  const featuresDir = path.join(root, FEATURES_DIR)
  if (!fs.existsSync(featuresDir)) {
    return []
  }

  return fs
    .readdirSync(featuresDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      name: entry.name,
      dir: path.join(featuresDir, entry.name, DESIGNS_DIR),
    }))
    .filter(project => fs.existsSync(path.join(project.dir, 'src', 'pages')))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The project the given directory sits in, if any. */
function findEnclosingProject(
  cwd: string,
  projects: MockupProject[],
): MockupProject | undefined {
  const resolved = path.resolve(cwd)
  return projects.find(
    project =>
      resolved === project.dir || resolved.startsWith(project.dir + path.sep),
  )
}

/**
 * Resolves which projects to act on: the ones named, else the one the current
 * directory sits in, else all of them.
 *
 * The middle case is what lets a designs package keep a plain `pnpm build` —
 * turbo runs it from that package's directory, so it builds only itself.
 */
export function resolveMockupProjects(
  names: string[],
  options: { cwd?: string; all?: boolean } = {},
): MockupProject[] {
  const { cwd = process.cwd(), all = false } = options

  const projects = findMockupProjects()
  if (projects.length === 0) {
    throw new Error(`No mockup projects found under ${MOCKUPS_GLOB}`)
  }

  if (names.length > 0) {
    return names.map(name => {
      const project = projects.find(p => p.name === name)
      if (!project) {
        const available = projects.map(p => p.name).join(', ')
        throw new Error(
          `Unknown mockup project "${name}". Available: ${available}`,
        )
      }
      return project
    })
  }

  if (all) {
    return projects
  }

  const enclosing = findEnclosingProject(cwd, projects)
  return enclosing ? [enclosing] : projects
}
