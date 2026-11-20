import { act, render } from '@testing-library/react'
import type { JSX } from 'react'

import {
  type PendingPassword,
  PendingPasswordProvider,
  usePendingPassword,
} from 'src/lib/pending-password'

function setup(): {
  api: () => PendingPassword
  unmount: () => void
  renders: () => number
} {
  let current: PendingPassword | null = null
  let count = 0
  function Probe(): JSX.Element {
    current = usePendingPassword()
    count++
    return <p>probe</p>
  }
  const { unmount } = render(
    <PendingPasswordProvider>
      <Probe />
    </PendingPasswordProvider>,
  )
  return {
    api: () => current as PendingPassword,
    unmount,
    renders: () => count,
  }
}

describe('PendingPasswordProvider', () => {
  it('returns a password once, then null', () => {
    const { api } = setup()
    api().set('hunter2')

    expect(api().take()).toBe('hunter2')
    expect(api().take()).toBeNull()
  })

  it('is null before anything is set', () => {
    expect(setup().api().take()).toBeNull()
  })

  it('clear forgets the password', () => {
    const { api } = setup()
    api().set('hunter2')
    api().clear()
    expect(api().take()).toBeNull()
  })

  it('a later set replaces the earlier one', () => {
    const { api } = setup()
    api().set('one')
    api().set('two')
    expect(api().take()).toBe('two')
  })

  it('never re-renders on set', () => {
    const { api, renders } = setup()
    const before = renders()
    act(() => api().set('hunter2'))
    expect(renders()).toBe(before)
  })

  it('is cleared when the provider unmounts', () => {
    const { api, unmount } = setup()
    const held = api()
    held.set('hunter2')
    unmount()
    expect(held.take()).toBeNull()
  })

  it('throws outside a provider', () => {
    const quiet = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    function Bare(): JSX.Element {
      usePendingPassword()
      return <p />
    }
    expect(() => render(<Bare />)).toThrow(/PendingPasswordProvider/)
    quiet.mockRestore()
  })
})
