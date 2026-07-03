import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'

import GitIdentityPage from 'src/app/git-identity/page'
import { api } from 'src/app/lib/api'
import type { GitIdentityListResponseDto } from 'src/console/git-identity.dto'

// Kept in its own file: React only logs "Each child in a list should have a
// unique key prop" once per process for a given component, so if this test
// shared a file with other tests that already render the identities table,
// an earlier render would consume the one-time warning and this assertion
// would silently pass regardless of whether the bug is present.
describe('GitIdentityPage — identity table keys', () => {
  it('renders the identity table without a missing-key console warning', async () => {
    const identities: GitIdentityListResponseDto = [
      {
        discordUserId: '111111111111111111',
        name: 'Bobby',
        email: 'bob@example.com',
        fingerprint: 'SHA256:abc',
        status: 'configured',
      },
      {
        discordUserId: '222222222222222222',
        name: 'Alice',
        email: 'alice@example.com',
        fingerprint: 'SHA256:def',
        status: 'decrypt_failed',
      },
    ]
    jest.spyOn(api, 'listGitIdentities').mockResolvedValue(identities)
    jest.spyOn(api, 'listDiscordGuildMembers').mockResolvedValue([])
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <GitIdentityPage />
      </QueryClientProvider>,
    )

    await screen.findByText('Bobby')
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(consoleErrorSpy.mock.calls.flat().join(' ')).not.toMatch(
      /unique "key" prop/,
    )

    consoleErrorSpy.mockRestore()
  })
})
