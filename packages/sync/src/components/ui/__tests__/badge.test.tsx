import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { Badge } from 'src/components/ui/badge'

describe('Badge', () => {
  it('renders children', () => {
    render(<Badge>Active</Badge>)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('forwards ref to the span element', () => {
    const ref = createRef<HTMLSpanElement>()
    render(<Badge ref={ref}>Ref test</Badge>)
    expect(ref.current).toBeInstanceOf(HTMLSpanElement)
  })
})
