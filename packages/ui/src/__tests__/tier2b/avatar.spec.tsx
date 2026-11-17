import { fireEvent, render, screen } from '@testing-library/react'

import { Avatar, AvatarStack } from 'src/avatar'

describe('Avatar', () => {
  it('uses the accent fill for you', () => {
    render(<Avatar initials="JA" self />)

    expect(screen.getByRole('img', { name: 'JA' })).toHaveClass(
      'bg-accent',
      'text-accent-ink',
      'rounded-full',
    )
  })

  it('uses the surface fill for everyone else', () => {
    render(<Avatar initials="TD" />)

    const el = screen.getByRole('img', { name: 'TD' })
    expect(el).toHaveClass('bg-surface-2', 'text-ink')
    expect(el).not.toHaveClass('bg-accent')
  })

  it.each([
    [24, 'size-6'],
    [32, 'size-8'],
    [40, 'size-10'],
    [64, 'size-16'],
  ] as const)('maps size %i to %s', (size, cls) => {
    render(<Avatar initials="JA" size={size} />)

    expect(screen.getByRole('img')).toHaveClass(cls)
  })

  it('names itself with the title when given', () => {
    render(<Avatar initials="JA" title="Jeremy · you" />)

    const el = screen.getByRole('img', { name: 'Jeremy · you' })
    expect(el).toHaveAttribute('title', 'Jeremy · you')
  })

  it('draws the photo over the initials', () => {
    const { container } = render(<Avatar initials="JA" src="/jeremy.png" />)

    expect(container.querySelector('img')).toHaveAttribute('src', '/jeremy.png')
    expect(screen.getByText('JA')).toBeInTheDocument()
  })

  it('falls back to the initials when the photo fails to load', () => {
    const { container } = render(<Avatar initials="JA" src="/missing.png" />)

    fireEvent.error(container.querySelector('img') as HTMLImageElement)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('JA')).toBeVisible()
  })

  it('retries when src changes after a failure', () => {
    const { container, rerender } = render(
      <Avatar initials="JA" src="/missing.png" />,
    )
    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    expect(container.querySelector('img')).toBeNull()

    rerender(<Avatar initials="JA" src="/other.png" />)
    expect(container.querySelector('img')).toHaveAttribute('src', '/other.png')
  })
})

describe('AvatarStack', () => {
  const people = [
    { initials: 'JA', self: true },
    { initials: 'TD' },
    { initials: 'MK' },
    { initials: 'LP' },
    { initials: 'QR' },
  ]

  it('shows max people and a +N for the rest', () => {
    render(<AvatarStack people={people} />)

    expect(screen.getAllByRole('img')).toHaveLength(4)
    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.queryByText('LP')).not.toBeInTheDocument()
  })

  it('has no overflow avatar when everyone fits', () => {
    render(<AvatarStack people={people.slice(0, 3)} />)

    expect(screen.getAllByRole('img')).toHaveLength(3)
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
  })

  it('overlaps by 8px with a bg ring', () => {
    render(<AvatarStack max={2} people={people} />)

    const [first, second] = screen.getAllByRole('img')
    expect(first).toHaveClass('ring-2', 'ring-bg')
    expect(second).toHaveClass('[&:not(:first-child)]:-ml-2')
  })
})
