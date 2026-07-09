import Link from 'next/link'

export default function SessionNotFound() {
  return (
    <div className="mx-auto max-w-2xl py-12 text-center">
      <p className="text-gray-400">Session not found.</p>
      <Link
        href="/sessions"
        className="mt-4 inline-block text-sm text-blue-400 hover:underline"
      >
        Back to sessions
      </Link>
    </div>
  )
}
