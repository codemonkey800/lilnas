'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function MessageRefresher() {
  const router = useRouter()

  useEffect(() => {
    const intervalId = window.setInterval(() => router.refresh(), 2000)
    return () => window.clearInterval(intervalId)
  }, [router])

  return null
}
