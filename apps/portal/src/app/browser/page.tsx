import type { Metadata } from 'next'

import { BrowserControl } from 'src/components/BrowserControl'
import {
  BROWSER_URL,
  getBrowserStatus,
  IDLE_TIMEOUT_MS,
  MAX_UPTIME_MS,
} from 'src/utils/browser'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Remote browser',
}

export default async function BrowserPage() {
  return (
    <BrowserControl
      browserUrl={BROWSER_URL}
      idleTimeoutMinutes={IDLE_TIMEOUT_MS / 60_000}
      initialStatus={await getBrowserStatus()}
      maxUptimeHours={MAX_UPTIME_MS / 3_600_000}
    />
  )
}
