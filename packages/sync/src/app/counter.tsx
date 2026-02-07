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
    <div className="flex flex-col items-center gap-8 animate-slide-up">
      <p className="text-8xl font-bold tabular-nums text-primary-300">
        {initialValue}
      </p>

      <div className="flex gap-3">
        <button
          className="flex h-12 w-12 items-center justify-center rounded-md bg-bg-surface text-2xl font-bold text-error transition-colors duration-150 ease-smooth hover:bg-bg-overlay focus-visible:shadow-focus disabled:opacity-40"
          disabled={isPending}
          onClick={handleDecrement}
        >
          -
        </button>

        <button
          className="flex h-12 w-12 items-center justify-center rounded-md bg-primary text-2xl font-bold text-text-inverse transition-colors duration-150 ease-smooth hover:bg-primary-600 focus-visible:shadow-focus disabled:opacity-40"
          disabled={isPending}
          onClick={handleIncrement}
        >
          +
        </button>
      </div>

      {isPending && (
        <p className="text-sm text-text-muted animate-pulse">Updating...</p>
      )}
    </div>
  )
}
