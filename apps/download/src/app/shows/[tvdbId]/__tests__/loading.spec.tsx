import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import ShowLoading from 'src/app/shows/[tvdbId]/loading'

describe('ShowLoading', () => {
  it('announces itself as busy rather than as empty', () => {
    render(<ShowLoading />)

    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true')
  })

  it('occupies the same column the page does, so nothing shifts as it is replaced', () => {
    render(<ShowLoading />)

    const column = screen.getByRole('main').firstElementChild

    expect(column?.getAttribute('class')).toBe('mx-auto max-w-[1080px]')
  })

  it('draws the page’s geometry rather than a spinner in an empty screen', () => {
    const { container } = render(<ShowLoading />)

    // Breadcrumb, poster, title, meta, two cast stubs, three header buttons,
    // three tabs, a heading, two season buttons, six episode lines.
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(15)
  })

  it('reserves the poster at the 2:3 crop the header uses', () => {
    const { container } = render(<ShowLoading />)

    expect(
      container.querySelector('[class*="aspect-[2/3]"]'),
    ).toBeInTheDocument()
  })

  it('offers nothing interactive - there is nothing to act on yet', () => {
    render(<ShowLoading />)

    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})
