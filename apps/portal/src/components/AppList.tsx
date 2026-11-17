import { Button, Card, EmptyState, Tile } from '@lilnas/ui'

import type { TileStatus } from 'src/utils/app-meta'
import {
  BROWSER_HOST,
  BROWSER_PAGE,
  BROWSER_TILE_STATUS,
  getAppIcon,
  getSubdomain,
} from 'src/utils/app-meta'
import { getBrowserStatus } from 'src/utils/browser'
import { getAppHosts } from 'src/utils/hosts'

async function getBrowserTileStatus(): Promise<TileStatus | undefined> {
  try {
    return BROWSER_TILE_STATUS[(await getBrowserStatus()).state]
  } catch {
    // The tile still opens the power page; it just has no status to show.
    return undefined
  }
}

export async function AppList() {
  const listed = await getAppHosts()
  // A stopped browser has no running container, so Docker doesn't list it, but
  // its tile is the only way to power it on: pin it whenever anything is up.
  const hosts =
    listed.length === 0 || listed.includes(BROWSER_HOST)
      ? listed
      : [...listed, BROWSER_HOST].sort((a, b) => a.localeCompare(b))
  const browserStatus = hosts.includes(BROWSER_HOST)
    ? await getBrowserTileStatus()
    : undefined

  return (
    <>
      <h1 className="mb-6 text-h1">lilnas apps</h1>

      {hosts.length === 0 ? (
        <Card>
          <EmptyState
            action={
              <Button
                icon="refresh"
                render={<a href="/" />}
                size="sm"
                variant="accent"
              >
                Reload
              </Button>
            }
            body="Start one on the server and it'll show up here."
            title="No apps are running"
          />
        </Card>
      ) : (
        <div className="stagger grid grid-cols-1 gap-3 md:grid-cols-3">
          {hosts.map(host => (
            <AppTile
              host={host}
              key={host}
              status={host === BROWSER_HOST ? browserStatus : undefined}
            />
          ))}
        </div>
      )}
    </>
  )
}

function AppTile({ host, status }: { host: string; status?: TileStatus }) {
  const isBrowser = host === BROWSER_HOST

  return (
    <Tile
      href={isBrowser ? BROWSER_PAGE : `https://${host}`}
      icon={getAppIcon(host)}
      meta={host}
      rel={isBrowser ? undefined : 'noreferrer noopener'}
      status={status?.label}
      statusTone={status?.tone}
      target={isBrowser ? undefined : '_blank'}
      title={getSubdomain(host)}
    />
  )
}
