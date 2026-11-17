import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(__dirname, '../../theme.css'), 'utf8')

describe('theme.css', () => {
  it.each([
    ['accent', '--color-accent: #9b7bf5'],
    ['accent-ink', '--color-accent-ink: #120a2a'],
    ['line-control', '--color-line-control: #6f688a'],
  ])('defines the %s token', (_name, declaration) => {
    expect(css).toContain(declaration)
  })

  it('has dropped the deprecated uv-* / ease-uv aliases', () => {
    expect(css).not.toMatch(/--color-uv/)
    expect(css).not.toMatch(/--ease-uv/)
    expect(css).not.toMatch(/Deprecated aliases/)
  })

  it.each(['h1', 'h2', 'h3', 'body', 'sm', 'cap', 'label', 'mono', 'mono-sm'])(
    'defines the text-%s size',
    name => {
      expect(css).toMatch(new RegExp(`--text-${name}: \\d+px;`))
    },
  )

  it.each(['stagger', 'transition-press', 'dot-live', 'skeleton'])(
    'ships the %s utility',
    name => {
      expect(css).toContain(`@utility ${name} {`)
    },
  )

  it('sets the compact density properties', () => {
    expect(css).toMatch(/\[data-density='compact'\][^}]*--control-h: 30px/)
    expect(css).toMatch(/\[data-density='compact'\][^}]*--control-h-sm: 26px/)
  })
})

describe('documented @source line', () => {
  const repoRoot = resolve(__dirname, '../../../..')
  const docs = [
    'packages/ui/README.md',
    'packages/ui/theme.css',
    'docs/designs/foundations.md',
    'docs/designs/adoption.md',
  ]

  it.each(docs)('%s points at the app-local node_modules', file => {
    const text = readFileSync(resolve(repoRoot, file), 'utf8')
    const paths = [...text.matchAll(/@source '([^']*@lilnas\/ui\/dist)'/g)].map(
      match => match[1] ?? '',
    )

    expect(paths.length).toBeGreaterThan(0)

    for (const path of paths) {
      // A stylesheet at apps/<app>/src/. injectWorkspacePackages puts the
      // package in apps/<app>/node_modules, not the repo-root node_modules
      // (which has no @lilnas/ui), and Tailwind ignores a missing @source.
      const resolved = resolve(repoRoot, 'apps/app/src', path)
      expect(resolved).toBe(
        resolve(repoRoot, 'apps/app/node_modules/@lilnas/ui/dist'),
      )
    }
  })
})
