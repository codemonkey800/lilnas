'use client'

import { useEffect, useState } from 'react'

export function Home() {
  const [status, setStatus] = useState<string>('checking...')

  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then(data => setStatus(data.status))
      .catch(() => setStatus('unreachable'))
  }, [])

  return (
    <div className="flex flex-auto items-center justify-center">
      <p className="text-lg">
        Backend status: <span className="font-mono">{status}</span>
      </p>
    </div>
  )
}
