import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Avatar } from 'src/components/ui/avatar'

describe('Avatar', () => {
  it('renders the first character of the initial, uppercased', () => {
    render(<Avatar initial="john" />)
    expect(screen.getByText('J')).toBeInTheDocument()
  })

  it('handles a single-character initial', () => {
    render(<Avatar initial="A" />)
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('uppercases a lowercase single character', () => {
    render(<Avatar initial="b" />)
    expect(screen.getByText('B')).toBeInTheDocument()
  })
})
