import { createRequire } from 'module'

const pkgRequire = createRequire(__filename)

function installedMajor(pkg: string): number {
  const { version } = pkgRequire(`${pkg}/package.json`) as { version: string }
  return Number(version.split('.')[0])
}

describe('LangChain dependency versions', () => {
  it.each(['@langchain/core', '@langchain/openai', '@langchain/langgraph'])(
    '%s is on 1.x or newer',
    pkg => {
      expect(installedMajor(pkg)).toBeGreaterThanOrEqual(1)
    },
  )

  it('does not resolve the removed community package', () => {
    const removed = ['@langchain', 'community'].join('/')

    expect(() => pkgRequire.resolve(removed)).toThrow()
  })
})
