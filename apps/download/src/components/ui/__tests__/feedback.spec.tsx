import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import { Skeleton, Spinner } from 'src/components/ui/feedback'

function renderRoot(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  const root = container.firstElementChild

  if (!(root instanceof HTMLElement)) {
    throw new Error('expected a single root element')
  }

  return root
}

describe('Spinner', () => {
  it('renders the indeterminate ring', () => {
    expect(renderRoot(<Spinner />)).toHaveClass(
      'h-[15px]',
      'w-[15px]',
      'animate-spin',
      'rounded-full',
      'border-2',
      'border-line',
      'border-t-uv',
    )
  })

  it('is decorative by default', () => {
    expect(renderRoot(<Spinner />)).toHaveAttribute('aria-hidden', 'true')
  })

  it('lets a caller announce it', () => {
    render(
      <Spinner aria-hidden={undefined} aria-label="Loading" role="status" />,
    )

    expect(screen.getByRole('status')).toHaveAccessibleName('Loading')
  })

  it('merges a caller className and spreads the rest onto the root', () => {
    const spinner = renderRoot(<Spinner className="mx-auto" data-testid="s" />)

    expect(spinner).toHaveClass('mx-auto', 'shrink-0')
    expect(spinner).toHaveAttribute('data-testid', 's')
  })
})

describe('Skeleton', () => {
  it('renders the shimmer placeholder', () => {
    expect(renderRoot(<Skeleton />)).toHaveClass('skeleton')
  })

  it('carries no intrinsic size', () => {
    const classes = Array.from(renderRoot(<Skeleton />).classList)

    expect(classes).toEqual(['skeleton'])
  })

  it('takes its size from the call site', () => {
    expect(renderRoot(<Skeleton className="h-4 w-32" />)).toHaveClass(
      'skeleton',
      'h-4',
      'w-32',
    )
  })

  it('is decorative', () => {
    expect(renderRoot(<Skeleton />)).toHaveAttribute('aria-hidden', 'true')
  })

  it('spreads the rest of its props onto the root', () => {
    expect(renderRoot(<Skeleton data-testid="k" />)).toHaveAttribute(
      'data-testid',
      'k',
    )
  })
})
