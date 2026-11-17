import type { ReactElement } from 'react'

import RootLayout from 'src/app/layout'

jest.mock('src/tailwind.css', () => ({}))
jest.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'geist-sans-var' }),
  Geist_Mono: () => ({ variable: 'geist-mono-var' }),
}))

type ElementProps = { className?: string; children?: ReactElement }

describe('RootLayout', () => {
  const html = RootLayout({ children: null }) as ReactElement<ElementProps>
  const body = html.props.children as ReactElement<ElementProps>

  it('puts the font variable classes on <html> so the :root @theme mapping resolves', () => {
    expect(html.type).toBe('html')
    expect(html.props.className).toContain('geist-sans-var')
    expect(html.props.className).toContain('geist-mono-var')
  })

  it('does not put the font variable classes on <body>', () => {
    expect(body.type).toBe('body')
    expect(body.props.className).not.toContain('geist-sans-var')
    expect(body.props.className).not.toContain('geist-mono-var')
  })

  it('applies the sans family to <body>', () => {
    expect(body.props.className?.split(/\s+/)).toContain('font-sans')
  })
})
