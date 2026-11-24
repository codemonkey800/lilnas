import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const appDir = join(__dirname, '..')
const layout = readFileSync(join(appDir, 'layout.tsx'), 'utf8')

describe('root layout fonts', () => {
  it('does not load fonts from Google at build time', () => {
    // `next/font/google` fetches fonts.gstatic.com during `next build`; a failed
    // fetch aborts the Turbopack build and the CI check that gates the image.
    expect(layout).not.toMatch(/from 'next\/font\/google'/)
  })

  it('serves every font file it references from the repo', () => {
    const sources = [...layout.matchAll(/src:\s*'(\.\/[^']+)'/g)].map(m => m[1])

    expect(sources.length).toBeGreaterThan(0)
    for (const src of sources) {
      expect(existsSync(join(appDir, src))).toBe(true)
    }
  })
})
