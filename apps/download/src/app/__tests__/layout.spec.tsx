import { render } from '@testing-library/react'

import AppLayout from 'src/app/layout'
import { iconSymbolId, PEPE_SYMBOL_ID } from 'src/components/ui/icon'
import type { Viewer } from 'src/lib/viewer'
import { getViewer } from 'src/lib/viewer'

// The layout imports the stylesheet for its side effect. Next.js handles that
// in the bundler; jest would try to parse `@import 'tailwindcss'` as
// JavaScript. Mocked here rather than added to jest.config.js's
// moduleNameMapper so this stays the only file that has to care.
jest.mock('src/tailwind.css', () => ({}))

// `next/font/google` is a build-time loader, not a runtime module — calling it
// outside next's bundler throws. The only thing the layout wants from it is the
// CSS variable class on <html>, so a stub of that shape exercises the real
// wiring without the loader. The stub names deliberately avoid a `font-`
// prefix: `cns` is twMerge, which would read `font-sans-x`/`font-mono-x` as two
// conflicting font-family utilities and drop the first. Real next/font
// variables are hashed (`__variable_e8ce0c`) and hit no such group.
jest.mock('next/font/google', () => ({
  Figtree: () => ({ variable: 'stub-sans-var' }),
  IBM_Plex_Mono: () => ({ variable: 'stub-mono-var' }),
}))

// The bar's nav-search slot now holds a client component that reads the App
// Router (`usePathname` to know whether it is on /search, `useRouter` to push a
// title query at it). A unit render has no router mounted, and `useRouter`
// throws rather than degrading, so both are stubbed at the route the shell is
// most often on. The real field's own behaviour is covered in
// src/components/shell/__tests__/nav-search.spec.tsx; what this file still
// asserts is that the slot is filled at all.
jest.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('src/lib/viewer', () => ({
  getViewer: jest.fn(),
}))

const mockGetViewer = jest.mocked(getViewer)

const VIEWER: Viewer = {
  email: 'jeremy@lilnas.io',
  isAdmin: true,
  userId: 'u_1',
}

/**
 * Renders the root layout and hands back the container.
 *
 * React 19 knows how to render a document root outside a document: `<html>`'s
 * and `<body>`'s props are applied to the real `document.documentElement` /
 * `document.body`, and their *children* land in RTL's container. So the
 * container below holds the sprite, the bar and the page — exactly the three
 * things this file is about — with no DOM-nesting complaints to suppress.
 */
async function renderLayout(viewer: Viewer | null): Promise<HTMLElement> {
  mockGetViewer.mockResolvedValue(viewer)

  return render(await AppLayout({ children: <p>page</p> })).container
}

function follows(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  )
}

describe('AppLayout', () => {
  it('renders the icon sprite exactly once', async () => {
    const container = await renderLayout(VIEWER)

    expect(
      container.querySelectorAll(`symbol[id="${PEPE_SYMBOL_ID}"]`),
    ).toHaveLength(1)
    expect(
      container.querySelectorAll(`symbol[id="${iconSymbolId('search')}"]`),
    ).toHaveLength(1)
  })

  it('renders the sprite before the app bar, so the pepe badge resolves', async () => {
    const container = await renderLayout(VIEWER)
    const sprite = container.querySelector(`symbol[id="${PEPE_SYMBOL_ID}"]`)
    const bar = container.querySelector('header')
    const badge = bar?.querySelector('use')

    expect(sprite).not.toBeNull()
    expect(bar).not.toBeNull()
    expect(follows(sprite as Element, bar as Element)).toBe(true)
    expect(badge).toHaveAttribute('href', `#${PEPE_SYMBOL_ID}`)
  })

  it('renders the app bar above the page', async () => {
    const container = await renderLayout(VIEWER)
    const bar = container.querySelector('header')
    const page = container.querySelector('p')

    expect(page).toHaveTextContent('page')
    expect(follows(bar as Element, page as Element)).toBe(true)
  })

  it('resolves the viewer once and passes it to the bar', async () => {
    const container = await renderLayout(VIEWER)

    expect(mockGetViewer).toHaveBeenCalledTimes(1)
    expect(
      container.querySelector('a[aria-label="Your account"]'),
    ).not.toBeNull()
  })

  it('fills the nav-search slot in the bar, exactly once', async () => {
    const container = await renderLayout(VIEWER)
    const bar = container.querySelector('header')

    // One field, one input — the slot is rendered once and CSS repositions it
    // at each width. Two slots would put two of each in the accessible tree.
    expect(bar?.querySelectorAll('[role="search"]')).toHaveLength(1)
    expect(bar?.querySelectorAll('input')).toHaveLength(1)
  })

  it('still renders the shell when there is no viewer', async () => {
    const container = await renderLayout(null)

    expect(container.querySelector('a[aria-label="Your account"]')).toBeNull()
    expect(container.querySelector('header')).not.toBeNull()
    expect(container.querySelector('p')).toHaveTextContent('page')
  })

  it('keeps the font variables on <html>', async () => {
    // React 19 applies `<html>`/`<body>` props to the real document elements
    // and renders their children into the container, so this is where the
    // layout's font wiring actually lands.
    await renderLayout(VIEWER)

    expect(document.documentElement).toHaveClass(
      'stub-sans-var',
      'stub-mono-var',
    )
    expect(document.documentElement).toHaveAttribute('lang', 'en')
  })
})
