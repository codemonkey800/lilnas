'use client'

import { cns } from '@lilnas/utils/cns'
import { useEffect, useState, useTransition } from 'react'

import {
  fetchBrowserStatus,
  powerOffBrowser,
  powerOnBrowser,
} from 'src/app/browser/actions'
import type { BrowserState, BrowserStatus } from 'src/utils/browser'

const POLL_INTERVAL_MS = 5000

const STATE_LABELS: Record<BrowserState, string> = {
  missing: 'Not created',
  stopped: 'Off',
  starting: 'Starting…',
  running: 'On',
}

const STATE_DOT_CLASSES: Record<BrowserState, string> = {
  missing: 'bg-red-500',
  stopped: 'bg-gray-500',
  starting: 'bg-yellow-400 animate-pulse',
  running: 'bg-green-500',
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
  const [error, setError] = useState<string | null>(null)
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

  function runAction(action: () => Promise<BrowserStatus>) {
    setError(null)
    startTransition(async () => {
      try {
        setStatus(await action())
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  const isOn = status.state === 'running' || status.state === 'starting'

  return (
    <div className="flex flex-col flex-auto items-center justify-center gap-8 bg-gray-900 p-6 text-white">
      <p className="text-4xl font-bold">Remote browser</p>

      <div className="flex items-center gap-3 text-2xl">
        <span
          className={cns(
            'inline-block size-4 rounded-full',
            STATE_DOT_CLASSES[status.state],
          )}
        />
        {STATE_LABELS[status.state]}
      </div>

      {status.state === 'missing' && (
        <p className="max-w-md text-center text-gray-400">
          The container doesn&apos;t exist yet. Create it once on the server
          with <code>docker-compose up -d browser</code>.
        </p>
      )}

      {status.state !== 'missing' && (
        <button
          className={cns(
            'w-full max-w-xs rounded-xl py-4 text-2xl font-semibold',
            'disabled:opacity-50',
            isOn
              ? 'bg-gray-700 hover:bg-gray-600'
              : 'bg-purple-600 hover:bg-purple-500',
          )}
          disabled={isPending}
          onClick={() => runAction(isOn ? powerOffBrowser : powerOnBrowser)}
          type="button"
        >
          {isPending ? 'Working…' : isOn ? 'Power off' : 'Power on'}
        </button>
      )}

      {status.state === 'running' && (
        <a
          className="w-full max-w-xs rounded-xl bg-purple-600 py-4 text-center text-2xl font-semibold hover:bg-purple-500"
          href={browserUrl}
          rel="noreferrer noopener"
          target="_blank"
        >
          Open browser
        </a>
      )}

      {isOn && status.autoStopAt && (
        <p className="text-center text-gray-400">
          Auto-stops in {formatMinutesFromNow(status.autoStopAt, now)}
        </p>
      )}

      {error && <p className="max-w-md text-center text-red-400">{error}</p>}

      <p className="max-w-md text-center text-sm text-gray-500">
        Stops after {idleTimeoutMinutes} min with no one viewing it, or after{' '}
        {maxUptimeHours} h regardless.
      </p>
    </div>
  )
}
