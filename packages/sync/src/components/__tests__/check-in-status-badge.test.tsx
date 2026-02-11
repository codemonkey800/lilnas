import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { CheckInStatusBadge } from 'src/components/check-in-status-badge'

describe('CheckInStatusBadge', () => {
  it.each([
    ['draft', 'Draft'],
    ['scheduled', 'Scheduled'],
    ['in_progress', 'In Progress'],
    ['completed', 'Completed'],
  ] as const)('renders "%s" status with label "%s"', (status, label) => {
    render(<CheckInStatusBadge status={status} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('forwards ref to the span element', () => {
    const ref = createRef<HTMLSpanElement>()
    render(<CheckInStatusBadge ref={ref} status="draft" />)
    expect(ref.current).toBeInstanceOf(HTMLSpanElement)
  })

  it('passes through additional className', () => {
    render(<CheckInStatusBadge status="completed" className="extra-class" />)
    const badge = screen.getByText('Completed')
    expect(badge.className).toContain('extra-class')
  })

  it('passes through additional HTML attributes', () => {
    render(
      <CheckInStatusBadge status="in_progress" data-testid="status-badge" />,
    )
    expect(screen.getByTestId('status-badge')).toBeInTheDocument()
  })
})
