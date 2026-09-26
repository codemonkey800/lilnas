import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import {
  ExternalLinks,
  FactCards,
  formatDay,
  httpHref,
  imdbLink,
  joinFacts,
} from 'src/components/detail/fact-section'

describe('formatDay', () => {
  it.each([
    ['2012-09-20T00:00:00Z', 'Sep 20, 2012'],
    // A bare day is UTC midnight too - never the day before.
    ['2026-05-17', 'May 17, 2026'],
  ])('reads %s as %s', (value, day) => {
    expect(formatDay(value)).toBe(day)
  })

  it.each([[undefined], [''], ['not a date']])('is null for %p', value => {
    expect(formatDay(value)).toBeNull()
  })
})

describe('joinFacts', () => {
  it('joins what is present', () => {
    expect(joinFacts(['a', null, '', undefined, 'b'])).toBe('a · b')
  })

  it('is null for nothing', () => {
    expect(joinFacts([null, undefined])).toBeNull()
  })
})

describe('httpHref', () => {
  it('passes http(s)', () => {
    expect(httpHref('https://example.com/a')).toBe('https://example.com/a')
  })

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,x'],
    ['nope'],
    [undefined],
  ])('⚠️ refuses %p', value => {
    expect(httpHref(value)).toBeNull()
  })
})

describe('imdbLink', () => {
  it('links a title id', () => {
    expect(imdbLink('tt0373732')).toEqual({
      href: 'https://www.imdb.com/title/tt0373732/',
      label: 'IMDb',
    })
  })

  it('refuses anything else', () => {
    expect(imdbLink('nm0000001')).toBeNull()
  })
})

describe('FactCards', () => {
  it('skips an empty section and lays a lone one out full width', () => {
    const { container } = render(
      <FactCards
        sections={[
          { facts: [], heading: 'Empty' },
          { facts: [{ label: 'A', value: 'b' }], heading: 'Full' },
        ]}
      />,
    )

    expect(screen.queryByRole('region', { name: 'Empty' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Full' })).toBeInTheDocument()
    expect(container.firstElementChild).not.toHaveClass('lg:grid-cols-2')
  })

  it('renders nothing when every section is empty', () => {
    const { container } = render(
      <FactCards sections={[{ facts: [], heading: 'Empty' }]} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})

describe('ExternalLinks', () => {
  it('renders nothing for no links', () => {
    const { container } = render(<ExternalLinks links={[]} />)

    expect(container).toBeEmptyDOMElement()
  })
})
