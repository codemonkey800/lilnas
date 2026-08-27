/**
 * Placeholder root route.
 *
 * The legacy UI was removed ahead of the frontend rewrite; this exists so the
 * App Router still emits a route and the container health-checks on :8080.
 * The API and WebSocket gateway remain live behind the `/api` and `/ws`
 * rewrites in `next.config.js`.
 */
export default function RootPage() {
  return (
    <main className="flex flex-auto items-center justify-center p-8">
      <h1>Download</h1>
    </main>
  )
}
