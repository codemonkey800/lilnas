import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import { LIBRARY_HREF, LibraryLink } from 'src/components/detail/library-link'

describe('LibraryLink', () => {
  it('points at the gallery by default', () => {
    render(<LibraryLink />)

    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute(
      'href',
      LIBRARY_HREF,
    )
  })

  it('is a real anchor, so middle-click and ⌘-click still work', () => {
    render(<LibraryLink />)

    expect(screen.getByRole('link', { name: 'Library' }).tagName).toBe('A')
  })

  it('takes a different destination and label', () => {
    render(<LibraryLink href="/shows/121361" label="The Wire" />)

    expect(screen.getByRole('link', { name: 'The Wire' })).toHaveAttribute(
      'href',
      '/shows/121361',
    )
  })

  it('mirrors the arrow so it points back', () => {
    const { container } = render(<LibraryLink />)

    expect(container.querySelector('svg')?.getAttribute('class')).toContain(
      '-scale-x-100',
    )
  })

  it('lets a page override the mixin margin it carries', () => {
    render(<LibraryLink className="mb-0" />)

    const classes =
      screen.getByRole('link', { name: 'Library' }).getAttribute('class') ?? ''

    // twMerge resolves in the caller's favour rather than leaving both.
    expect(classes).toContain('mb-0')
    expect(classes).not.toContain('mb-[22px]')
  })
})
