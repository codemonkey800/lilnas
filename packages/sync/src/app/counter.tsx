'use client'

import { useTransition } from 'react'

import { decrementCounter, incrementCounter } from './actions'

interface CounterProps {
  initialValue: number
}

export function Counter({ initialValue }: CounterProps) {
  const [isPending, startTransition] = useTransition()

  function handleIncrement() {
    startTransition(async () => {
      await incrementCounter()
      window.location.reload()
    })
  }

  function handleDecrement() {
    startTransition(async () => {
      await decrementCounter()
      window.location.reload()
    })
  }

  return (
    <div className="flex flex-col items-center gap-8">
      <p className="text-8xl font-bold tabular-nums">{initialValue}</p>

      <div className="flex gap-4">
        <button
          className="flex h-12 w-12 items-center justify-center rounded-lg bg-red-500 text-2xl font-bold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
          disabled={isPending}
          onClick={handleDecrement}
        >
          -
        </button>

        <button
          className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-500 text-2xl font-bold text-white transition-colors hover:bg-green-600 disabled:opacity-50"
          disabled={isPending}
          onClick={handleIncrement}
        >
          +
        </button>
      </div>

      {isPending && (
        <p className="text-sm text-gray-400">Updating...</p>
      )}
    </div>
  )
}
