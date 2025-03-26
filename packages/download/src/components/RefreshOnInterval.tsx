'use client'

import { useRouter } from 'next/navigation'
import { useMemo } from 'react'

export function RefreshOnInterval({ interval }: { interval: number }) {
  const router = useRouter()

  useMemo(() => {
    const intervalId = setInterval(() => {
      router.refresh()
      console.log('refreshing')
    }, interval)
    return () => clearInterval(intervalId)
  }, [interval, router])

  return null
}
