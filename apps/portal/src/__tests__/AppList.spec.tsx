import { render, screen, within } from '@testing-library/react'

import { AppList } from 'src/components/AppList'
import { getBrowserStatus } from 'src/utils/browser'
import { getAppHosts } from 'src/utils/hosts'

jest.mock('src/utils/hosts', () => ({ getAppHosts: jest.fn() }))
jest.mock('src/utils/browser', () => ({ getBrowserStatus: jest.fn() }))

const mockHosts = jest.mocked(getAppHosts)
const mockBrowser = jest.mocked(getBrowserStatus)

async function renderList() {
  render(await AppList())
}

describe('AppList', () => {
  beforeEach(() => {
    mockBrowser.mockResolvedValue({ state: 'stopped' })
  })

  it('renders a tile per host with the subdomain title and a mono host', async () => {
    mockHosts.mockResolvedValue(['dev.lilnas.io', 'grafana.lilnas.io'])

    await renderList()

    expect(
      screen.getByRole('heading', { name: 'lilnas apps' }),
    ).toBeInTheDocument()

    const grafana = screen.getByRole('link', { name: /grafana/ })
    expect(grafana).toHaveAttribute('href', 'https://grafana.lilnas.io')
    expect(grafana).toHaveAttribute('target', '_blank')
    expect(within(grafana).getByText('grafana.lilnas.io')).toHaveClass(
      'font-mono',
    )
    expect(within(grafana).getByText('grafana')).toBeInTheDocument()
  })

  it('pins the browser tile to the power page with its status', async () => {
    mockHosts.mockResolvedValue(['dev.lilnas.io'])
    mockBrowser.mockResolvedValue({ state: 'running' })

    await renderList()

    const tile = screen.getByRole('link', { name: /browser/ })
    expect(tile).toHaveAttribute('href', '/browser')
    expect(tile).not.toHaveAttribute('target')
    expect(within(tile).getByText('On')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('leaves the browser tile without a status when Docker cannot say', async () => {
    mockHosts.mockResolvedValue(['browser.lilnas.io'])
    mockBrowser.mockRejectedValue(new Error('no socket'))

    await renderList()

    const tile = screen.getByRole('link', { name: /browser/ })
    expect(tile).toHaveAttribute('href', '/browser')
    expect(within(tile).queryByText('Off')).not.toBeInTheDocument()
  })

  it('shows the empty state with one action when no hosts are running', async () => {
    mockHosts.mockResolvedValue([])

    await renderList()

    expect(screen.getByText('No apps are running')).toBeInTheDocument()
    const reload = screen.getByRole('link', { name: 'Reload' })
    expect(reload).toHaveAttribute('href', '/')
    // The one action is the only link; no browser tile sneaks in.
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(mockBrowser).not.toHaveBeenCalled()
  })
})
