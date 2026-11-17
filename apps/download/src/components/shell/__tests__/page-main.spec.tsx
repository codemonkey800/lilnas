import { render, screen } from '@testing-library/react'

import { PageMain } from 'src/components/shell/page-main'

describe('PageMain', () => {
  it('is the page’s main landmark, padded the way every mockup draws it', () => {
    render(<PageMain>body</PageMain>)

    expect(screen.getByRole('main')).toHaveClass(
      'flex-auto',
      'px-4',
      'pt-5',
      'pb-8',
      'sm:px-8',
      'sm:pt-8',
      'sm:pb-12',
    )
  })

  it('centres its content in a 1080px column', () => {
    render(<PageMain>body</PageMain>)

    expect(screen.getByText('body')).toHaveClass('mx-auto', 'max-w-[1080px]')
  })

  it('narrows to 720px for a screen that is one panel', () => {
    render(<PageMain narrow>body</PageMain>)

    expect(screen.getByText('body')).toHaveClass('mx-auto', 'max-w-[720px]')
    expect(screen.getByText('body')).not.toHaveClass('max-w-[1080px]')
  })

  it('merges className and spreads the rest onto the main', () => {
    render(
      <PageMain aria-busy="true" className="overflow-y-auto">
        body
      </PageMain>,
    )

    expect(screen.getByRole('main')).toHaveClass('overflow-y-auto', 'flex-auto')
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true')
  })
})
