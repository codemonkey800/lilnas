import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import RootNotFound, { metadata } from 'src/app/not-found'
import { LIBRARY_HREF } from 'src/components/detail/library-link'
import {
  NOT_FOUND_BACK_LABEL,
  NOT_FOUND_DESCRIPTION,
  NOT_FOUND_TITLE,
} from 'src/components/shell/not-found'

describe('RootNotFound', () => {
  it('renders the shared panel rather than a design of its own', () => {
    render(<RootNotFound />)

    expect(
      screen.getByRole('heading', { level: 2, name: NOT_FOUND_TITLE }),
    ).toBeInTheDocument()
    expect(screen.getByText(NOT_FOUND_DESCRIPTION)).toBeInTheDocument()
  })

  it('⚠️ still titles the document, because the panel is only an h2', () => {
    render(<RootNotFound />)
    const heading = screen.getByRole('heading', {
      level: 1,
      name: NOT_FOUND_TITLE,
    })

    // Visually redundant with the panel's own, so it is `sr-only` — the same
    // call `/profile` makes for `NotAuthorized`.
    expect(heading).toHaveClass('sr-only')
  })

  it('offers the library as the way out, through a real anchor', () => {
    render(<RootNotFound />)

    expect(
      screen.getByRole('link', { name: NOT_FOUND_BACK_LABEL }),
    ).toHaveAttribute('href', LIBRARY_HREF)
  })

  it('occupies the same column every other route does', () => {
    const { container } = render(<RootNotFound />)
    const main = screen.getByRole('main')

    expect(main.getAttribute('class')).toContain('flex-auto')
    expect(
      container.querySelector('.mx-auto.max-w-\\[1080px\\]'),
    ).toBeInTheDocument()
  })

  it('⚠️ names the tab, which the root layout does not', () => {
    // Verified against the running dev server: Next *does* read `metadata`
    // from `not-found.tsx` on 15.5.20, and without it `/nope` renders with an
    // empty `<title>`. Applied only when no route matched — a route that
    // reached `notFound()` keeps its own resolved title.
    expect(metadata.title).toBe('Not found · Download')
  })

  it('is not the error register — nothing here claims a fault', () => {
    const { container } = render(<RootNotFound />)

    expect(screen.queryByRole('alert')).toBeNull()
    expect(container.querySelectorAll('[class*="bad"]')).toHaveLength(0)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
