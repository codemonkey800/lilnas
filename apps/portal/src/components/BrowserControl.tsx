'use client'

import type { StatusDotTone } from '@lilnas/ui'
import { Button, Card, Icon, Kbd, Note, StatusDot } from '@lilnas/ui'
import { useEffect, useState, useTransition } from 'react'

import {
  fetchBrowserStatus,
  powerOffBrowser,
  powerOnBrowser,
} from 'src/app/browser/actions'
import type { BrowserState, BrowserStatus } from 'src/utils/browser'

const POLL_INTERVAL_MS = 5000

const STATE_LABELS: Record<BrowserState, string> = {
  missing: 'Not installed',
  stopped: 'Stopped',
  starting: 'Starting…',
  running: 'Running',
}

const STATE_TONES: Record<BrowserState, StatusDotTone> = {
  missing: 'bad',
  stopped: 'idle',
  starting: 'warn',
  running: 'ok',
}

function formatMinutesFromNow(timestamp: number, now: number) {
  const minutes = Math.max(0, Math.round((timestamp - now) / 60_000))

  if (minutes < 60) {
    return `${minutes} min`
  }

  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

interface BrowserControlProps {
  initialStatus: BrowserStatus
  browserUrl: string
  idleTimeoutMinutes: number
  maxUptimeHours: number
}

export function BrowserControl({
  initialStatus,
  browserUrl,
  idleTimeoutMinutes,
  maxUptimeHours,
}: BrowserControlProps) {
  const [status, setStatus] = useState(initialStatus)
  const [error, setError] = useState<{
    action: string
    message: string
  } | null>(null)
  const [isPending, startTransition] = useTransition()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now())
      fetchBrowserStatus()
        .then(setStatus)
        .catch(() => {
          // Transient; the next poll retries.
        })
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [])

  function runAction(
    label: 'on' | 'off',
    action: () => Promise<BrowserStatus>,
  ) {
    setError(null)
    startTransition(async () => {
      try {
        setStatus(await action())
      } catch (err) {
        setError({
          action: label,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    })
  }

  const isOn = status.state === 'running' || status.state === 'starting'

  const toggleLabel = isOn ? 'Turn off' : 'Turn on'
  const workingLabel = isOn ? 'Turning off' : 'Turning on'
  const buttonClass = 'max-md:h-11 max-md:w-full max-md:px-5 max-md:text-[15px]'

  return (
    <>
      <a
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-ink-3 transition-colors duration-200 hover:text-ink"
        href="/"
      >
        <Icon className="-scale-x-100 text-ink-4" name="arrow" size={12} />
        All apps
      </a>
      <h1 className="mb-6 text-h1">Remote browser</h1>

      <Card className="max-w-[520px]">
        <div
          className="flex flex-wrap items-center gap-x-2.5 gap-y-1"
          role="status"
        >
          <StatusDot
            data-testid="browser-status-dot"
            pulse={status.state === 'running'}
            tone={STATE_TONES[status.state]}
          />
          <h2 className="text-h3">{STATE_LABELS[status.state]}</h2>
          {isOn && status.autoStopAt && (
            <span className="text-sm text-ink-3">
              · stops in {formatMinutesFromNow(status.autoStopAt, now)}
            </span>
          )}
        </div>

        {status.state === 'starting' && (
          <p className="mt-1.5 text-sm text-ink-3">
            Waiting for the browser to answer. Usually under a minute.
          </p>
        )}

        {status.state === 'missing' ? (
          <>
            <p className="mt-4 text-sm text-ink-2">
              The browser container doesn&apos;t exist yet. Create it once on
              the server:
            </p>
            <Card className="mt-3 overflow-x-auto px-3 py-2.5" variant="sunk">
              <Kbd className="bg-transparent p-0 text-mono whitespace-nowrap">
                <span className="mr-2 text-ink-4 select-none">$</span>
                docker compose up -d browser
              </Kbd>
            </Card>
          </>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-2 md:flex-row">
              {status.state === 'running' && (
                <Button
                  className={buttonClass}
                  iconEnd="external"
                  render={
                    <a
                      href={browserUrl}
                      rel="noreferrer noopener"
                      target="_blank"
                    />
                  }
                  variant="accent"
                >
                  Open browser
                </Button>
              )}
              <Button
                className={buttonClass}
                loading={isPending}
                onClick={() =>
                  runAction(
                    isOn ? 'off' : 'on',
                    isOn ? powerOffBrowser : powerOnBrowser,
                  )
                }
                variant={isOn ? 'outline' : 'accent'}
              >
                {isPending ? workingLabel : toggleLabel}
              </Button>
            </div>

            {error && (
              <Note
                className="mt-4"
                icon={<Icon name="alert" />}
                lead={`Couldn't turn it ${error.action}.`}
                tone="bad"
              >
                Try again in a minute.
                <span className="mt-0.5 block font-mono text-mono-sm text-ink-3">
                  {error.message}
                </span>
              </Note>
            )}
          </>
        )}

        <p className="mt-4 border-t border-line-soft pt-3 text-cap text-ink-3">
          Stops after{' '}
          <span className="font-mono text-mono-sm">
            {idleTimeoutMinutes} min
          </span>{' '}
          with no one viewing it, or after{' '}
          <span className="font-mono text-mono-sm">{maxUptimeHours} h</span>{' '}
          regardless.
        </p>
      </Card>
    </>
  )
}
