import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import type { CastMember } from 'src/components/detail/cast-row'
import { castInitials, CastRow } from 'src/components/detail/cast-row'

const CAST: CastMember[] = [
  { name: 'Jeremy Theobald' },
  { name: 'Alex Haw' },
  { name: 'Lucy Russell' },
  { name: 'John Nolan' },
  { name: 'Dick Bradsell' },
  { name: 'Gillian El-Kadi' },
]

describe('castInitials', () => {
  it('takes one letter from each of the first two words', () => {
    expect(castInitials('Jodie Foster')).toBe('JF')
  })

  it('takes the first two letters of a single name, never one lonely letter', () => {
    expect(castInitials('Cher')).toBe('CH')
  })

  it('ignores the words past the second', () => {
    expect(castInitials('Mary Elizabeth Winstead')).toBe('ME')
  })

  it('tolerates a name with nothing usable in it', () => {
    expect(castInitials('   ')).toBe('?')
  })
})

describe('CastRow', () => {
  it('renders nothing at all for an empty cast', () => {
    const { container } = render(<CastRow people={[]} />)

    // Which is every title today — no media type on the wire carries a cast.
    expect(container).toBeEmptyDOMElement()
  })

  it('draws four names before collapsing the rest into a count', () => {
    render(<CastRow people={CAST} />)

    expect(screen.getByText('Jeremy Theobald')).toBeInTheDocument()
    expect(screen.getByText('John Nolan')).toBeInTheDocument()
    expect(screen.queryByText('Dick Bradsell')).not.toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.getByText('more')).toBeInTheDocument()
  })

  it('keeps the collapsed names in the overflow title', () => {
    render(<CastRow people={CAST} />)

    expect(screen.getByText('+2')).toHaveAttribute(
      'title',
      'Dick Bradsell, Gillian El-Kadi',
    )
  })

  it('draws no overflow marker when everybody fits', () => {
    render(<CastRow people={CAST.slice(0, 4)} />)

    expect(screen.queryByText('more')).not.toBeInTheDocument()
  })

  it('takes the limit the page asks for', () => {
    render(<CastRow limit={2} people={CAST} />)

    expect(screen.getByText('+4')).toBeInTheDocument()
    expect(screen.queryByText('Lucy Russell')).not.toBeInTheDocument()
  })

  it('derives initials from the name, and takes an override', () => {
    render(
      <CastRow
        people={[
          { name: 'Lucy Russell' },
          { initials: 'XX', name: 'Alex Haw' },
        ]}
      />,
    )

    expect(screen.getByText('LR')).toBeInTheDocument()
    expect(screen.getByText('XX')).toBeInTheDocument()
  })

  it('wraps rather than scrolling sideways', () => {
    const { container } = render(<CastRow people={CAST} />)

    expect(container.firstElementChild?.getAttribute('class')).toContain(
      'flex-wrap',
    )
  })
})
