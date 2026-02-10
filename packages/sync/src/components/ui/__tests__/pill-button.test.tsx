import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { PillButton } from 'src/components/ui/pill-button'

describe('PillButton', () => {
  it('renders children', () => {
    render(<PillButton>Hiking</PillButton>)
    expect(screen.getByRole('button', { name: 'Hiking' })).toBeInTheDocument()
  })

  it('has type="button" by default', () => {
    render(<PillButton>Tag</PillButton>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })

  it('forwards ref to the button element', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<PillButton ref={ref}>Ref</PillButton>)
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })
})
