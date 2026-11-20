import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import RootLayout from 'src/app/layout'

jest.mock('src/tailwind.css', () => ({}))
jest.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'geist-sans-var' }),
  Geist_Mono: () => ({ variable: 'geist-mono-var' }),
}))

type ElementProps = { className?: string; children?: ReactElement }

describe('RootLayout', () => {
  const html = RootLayout({
    children: <p>page body</p>,
  }) as ReactElement<ElementProps>
  const body = html.props.children as ReactElement<ElementProps>

  it('renders the app bar doorplate and its children', () => {
    // <html> cannot be a child of the test container, so render its content.
    render(body.props.children)

    expect(screen.getByText('page body')).toBeInTheDocument()
    expect(screen.getByText(/icloud-backup/)).toBeInTheDocument()
  })

  it('puts the font variable classes on <html>', () => {
    expect(html.props.className).toContain('geist-sans-var')
    expect(html.props.className).toContain('geist-mono-var')
  })
})
