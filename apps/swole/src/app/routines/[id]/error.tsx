'use client'

export default function EditRoutineError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p>Something went wrong saving this routine.</p>
      <button onClick={() => reset()}>Try again</button>
      <a href="/">Back to home</a>
    </div>
  )
}
