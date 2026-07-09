export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-700 p-8 text-center">
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  )
}
