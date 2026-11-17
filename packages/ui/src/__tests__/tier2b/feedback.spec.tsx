import { render, screen } from '@testing-library/react'

import { Meter, Progress, Skeleton, Spinner } from 'src/feedback'

describe('Progress', () => {
  it('exposes aria values and the accent tone by default', () => {
    render(<Progress label="Download" max={200} value={50} />)

    const bar = screen.getByRole('progressbar', { name: 'Download' })
    expect(bar).toHaveAttribute('aria-valuenow', '50')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '200')

    const fill = bar.firstElementChild as HTMLElement
    expect(fill).toHaveClass('bg-accent', 'ease-standard')
    expect(fill).toHaveStyle({ width: '25%' })
  })

  it.each([
    ['ok', 'bg-ok'],
    ['bad', 'bg-bad'],
  ] as const)('paints the %s tone', (tone, cls) => {
    render(<Progress tone={tone} value={40} />)

    expect(screen.getByRole('progressbar').firstElementChild).toHaveClass(cls)
  })

  it('clamps value into [0, max]', () => {
    const { rerender } = render(<Progress value={250} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '100',
    )

    rerender(<Progress value={-5} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '0',
    )
  })

  it('ignores value when indeterminate and drops aria-valuenow', () => {
    render(<Progress indeterminate tone="ok" value={70} />)

    const bar = screen.getByRole('progressbar')
    expect(bar).not.toHaveAttribute('aria-valuenow')
    const band = bar.firstElementChild as HTMLElement
    expect(band).toHaveAttribute('data-indeterminate')
    expect(band).toHaveClass('animate-shimmer', '[animation-duration:1.4s]')
    expect(band.style.width).toBe('')
  })
})

describe('Meter', () => {
  const fillOf = () =>
    screen.getByRole('meter').firstElementChild as HTMLElement

  it('shows the label row and aria values', () => {
    render(
      <Meter detail="412 GB of 1 TB" label="Storage" max={1000} value={412} />,
    )

    const meter = screen.getByRole('meter', { name: 'Storage' })
    expect(meter).toHaveAttribute('aria-valuenow', '412')
    expect(meter).toHaveAttribute('aria-valuemax', '1000')
    expect(meter).toHaveClass('h-2.5')
    expect(screen.getByText('412 GB of 1 TB')).toHaveClass('text-ink-3')
    expect(fillOf()).toHaveClass('bg-accent')
  })

  it.each([
    [80, 'bg-accent'],
    [81, 'bg-warn'],
    [95, 'bg-warn'],
    [96, 'bg-bad'],
  ])('at %i%% the fill is %s', (value, cls) => {
    render(<Meter label="Storage" max={100} value={value} />)

    expect(fillOf()).toHaveClass(cls)
  })

  it('clamps out-of-range values', () => {
    const { rerender } = render(<Meter label="Quota" max={10} value={50} />)
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '10')
    expect(fillOf()).toHaveStyle({ width: '100%' })

    rerender(<Meter label="Quota" max={10} value={-1} />)
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0')
    expect(fillOf()).toHaveStyle({ width: '0%' })
  })
})

describe('Spinner and Skeleton', () => {
  it('sizes the spinner and hides it from assistive tech', () => {
    const { container } = render(<Spinner size={24} />)

    const spinner = container.firstElementChild as HTMLElement
    expect(spinner).toHaveAttribute('aria-hidden', 'true')
    expect(spinner).toHaveStyle({ width: '24px', height: '24px' })
  })

  it('defaults the spinner to 16px', () => {
    const { container } = render(<Spinner />)

    expect(container.firstElementChild).toHaveStyle({ width: '16px' })
  })

  it('lets the caller shape the skeleton', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />)

    expect(container.firstElementChild).toHaveClass('skeleton', 'h-4', 'w-32')
  })
})
