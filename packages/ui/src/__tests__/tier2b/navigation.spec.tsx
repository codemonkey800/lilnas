import { fireEvent, render, screen } from '@testing-library/react'

import { Breadcrumb, Kbd, Pagination } from 'src/navigation'

describe('Breadcrumb', () => {
  const items = [
    { label: 'Library', href: '/library' },
    { label: 'Movies', href: '/library/movies' },
    { label: 'Dune: Part Two' },
  ]

  it('marks only the last item aria-current="page"', () => {
    render(<Breadcrumb items={items} />)

    const current = screen.getByText('Dune: Part Two')
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).toHaveClass('font-medium', 'text-ink')
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1)
  })

  it('links earlier items and hides the separators', () => {
    render(<Breadcrumb items={items} />)

    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute(
      'href',
      '/library',
    )
    expect(screen.getAllByText('/')).toHaveLength(2)
    screen
      .getAllByText('/')
      .forEach(el => expect(el).toHaveAttribute('aria-hidden', 'true'))
  })

  it('does not link the current page even if it has an href', () => {
    render(
      <Breadcrumb
        items={[
          { label: 'A', href: '/a' },
          { label: 'B', href: '/b' },
        ]}
      />,
    )

    expect(screen.queryByRole('link', { name: 'B' })).not.toBeInTheDocument()
  })
})

describe('Pagination', () => {
  it('disables Previous on the first page', () => {
    const onPageChange = jest.fn()
    render(<Pagination onPageChange={onPageChange} page={1} pageCount={5} />)

    const prev = screen.getByRole('button', { name: 'Previous page' })
    expect(prev).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled()

    fireEvent.click(prev)
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('disables Next on the last page', () => {
    render(<Pagination onPageChange={jest.fn()} page={5} pageCount={5} />)

    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled()
  })

  it('calls onPageChange for previous, next and numbered pages', () => {
    const onPageChange = jest.fn()
    render(<Pagination onPageChange={onPageChange} page={3} pageCount={5} />)

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    fireEvent.click(screen.getByRole('button', { name: 'Page 5' }))

    expect(onPageChange.mock.calls).toEqual([[2], [4], [5]])
  })

  it('marks the current page and styles it with the accent', () => {
    render(<Pagination onPageChange={jest.fn()} page={2} pageCount={3} />)

    const current = screen.getByRole('button', { name: 'Page 2' })
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).toHaveClass('bg-accent', 'text-accent-ink')
    expect(screen.getByRole('button', { name: 'Page 1' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('collapses distant pages into an ellipsis', () => {
    render(<Pagination onPageChange={jest.fn()} page={6} pageCount={12} />)

    const labels = screen
      .getAllByRole('button')
      .map(b => b.getAttribute('aria-label'))
    expect(labels).toEqual([
      'Previous page',
      'Page 1',
      'Page 5',
      'Page 6',
      'Page 7',
      'Page 12',
      'Next page',
    ])
    expect(screen.getAllByText('…')).toHaveLength(2)
  })

  it('labels the nav', () => {
    render(
      <Pagination
        label="Search results"
        onPageChange={jest.fn()}
        page={1}
        pageCount={2}
      />,
    )

    expect(
      screen.getByRole('navigation', { name: 'Search results' }),
    ).toBeInTheDocument()
  })
})

describe('Kbd', () => {
  it('renders inline code', () => {
    render(<Kbd>⌘K</Kbd>)

    expect(screen.getByText('⌘K').tagName).toBe('CODE')
  })
})
