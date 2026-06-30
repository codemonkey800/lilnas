export function ErrorState({ message }: { message?: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-red-800 p-8 text-center">
      <p className="text-sm text-red-400">
        {message ?? 'An error occurred. Please try again.'}
      </p>
    </div>
  )
}
