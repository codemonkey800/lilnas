import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import GitIdentityPage from 'src/app/git-identity/page'
import { api } from 'src/app/lib/api'
import type {
  DiscordGuildMemberListResponseDto,
  GitIdentityListResponseDto,
} from 'src/console/git-identity.dto'

const MEMBERS: DiscordGuildMemberListResponseDto = [
  { id: '111111111111111111', username: 'bob', displayName: 'Bobby' },
  { id: '222222222222222222', username: 'alice', displayName: 'Alice' },
]

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <GitIdentityPage />
      </QueryClientProvider>,
    ),
  }
}

let listMembersSpy: jest.SpyInstance

beforeEach(() => {
  jest.spyOn(api, 'listGitIdentities').mockResolvedValue([])
  listMembersSpy = jest
    .spyOn(api, 'listDiscordGuildMembers')
    .mockResolvedValue(MEMBERS)
})

describe('GitIdentityPage — Discord member dropdown', () => {
  it('renders the fetched members as options', async () => {
    renderPage()

    const select = await screen.findByRole('combobox')
    await waitFor(() => {
      expect(
        within(select).getByRole('option', {
          name: 'Bobby (111111111111111111)',
        }),
      ).toBeInTheDocument()
    })
    expect(
      within(select).getByRole('option', {
        name: 'Alice (222222222222222222)',
      }),
    ).toBeInTheDocument()
  })

  it('selecting a member submits that id', async () => {
    const upsertSpy = jest.spyOn(api, 'upsertGitIdentity').mockResolvedValue({
      discordUserId: '222222222222222222',
      fingerprint: 'SHA256:abc',
      status: 'configured',
    })
    const user = userEvent.setup()
    renderPage()

    const select = await screen.findByRole('combobox')
    await waitFor(() =>
      expect(
        within(select).getByRole('option', {
          name: 'Alice (222222222222222222)',
        }),
      ).toBeInTheDocument(),
    )
    await user.selectOptions(select, '222222222222222222')

    await user.type(screen.getByPlaceholderText('Jane Doe'), 'Alice')
    await user.type(
      screen.getByPlaceholderText('jane@example.com'),
      'alice@example.com',
    )
    await user.type(
      screen.getByPlaceholderText(/BEGIN OPENSSH PRIVATE KEY/),
      'fake-key',
    )
    await user.click(screen.getByRole('button', { name: 'Save identity' }))

    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1))
    expect(upsertSpy.mock.calls[0]?.[0]).toMatchObject({
      discordUserId: '222222222222222222',
    })
  })

  it('shows an error state with a Retry action when the members fetch fails', async () => {
    listMembersSpy.mockReset().mockRejectedValue(new Error('boom'))
    renderPage()

    expect(
      await screen.findByText(/Couldn.t load Discord members\./),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('the Refresh button forces a cache-bypassing refetch', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('combobox')
    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() =>
      expect(listMembersSpy).toHaveBeenCalledWith({ force: true }),
    )
  })

  it('shows an "Unknown member" option for a Replace target no longer in the fetched list', async () => {
    const staleIdentity: GitIdentityListResponseDto = [
      {
        discordUserId: '999999999999999999',
        name: 'Gone User',
        email: 'gone@example.com',
        fingerprint: 'SHA256:xyz',
        status: 'configured',
      },
    ]
    jest.spyOn(api, 'listGitIdentities').mockResolvedValue(staleIdentity)
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Replace' }))

    const select = await screen.findByRole('combobox')
    await waitFor(() =>
      expect(
        within(select).getByRole('option', {
          name: 'Unknown member (999999999999999999)',
        }),
      ).toBeInTheDocument(),
    )
  })
})
