export function LoadingState({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center">
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  )
}
