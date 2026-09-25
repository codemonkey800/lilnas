// Wiring smoke test for the jsdom Jest project. This file asserts nothing
// about the app itself — it exists so that the three things that have to be
// true for ANY component test to run stay covered, and fail loudly here
// rather than as a confusing error inside a real component spec:
//
//   1. a .tsx file under src/ is collected at all (testMatch),
//   2. it runs in a DOM environment (testEnvironment: 'jsdom'),
//   3. src/__tests__/setup-dom.ts actually loaded (setupFilesAfterEnv).
//
// (3) is why this file deliberately does NOT import
// '@testing-library/jest-dom' itself, unlike the component specs: using a
// jest-dom matcher here with no local import only works if the setup module
// registered it, so the assertion below is the setup wiring's only test.
import { render, screen } from '@testing-library/react'

describe('jsdom test environment', () => {
  it('renders a div', () => {
    render(<div data-testid="smoke">hello</div>)

    expect(screen.getByTestId('smoke')).toBeInTheDocument()
  })

  it('runs in a DOM environment rather than node', () => {
    expect(typeof document).toBe('object')
    expect(typeof window).toBe('object')
  })

  it('has jest-dom matchers registered by setup-dom.ts', () => {
    // Not imported in this file (see header) — its presence proves the
    // jsdom project's setupFilesAfterEnv ran.
    expect(expect(document.body).toBeInTheDocument).toBeDefined()
  })
})
