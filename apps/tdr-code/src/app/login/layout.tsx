import { type ReactNode } from 'react'

// NOTE on what this file does and does NOT do: it does NOT remove NavShell
// chrome from /login — a nested layout like this one only wraps CONTENT
// inside the root layout's <NavShell>{children}</NavShell>; it has no way to
// un-wrap an ancestor. NavShell itself (src/app/components/nav-shell.tsx)
// carries the actual `pathname === '/login'` guard that suppresses its own
// header for this one route — verified by reading how Next's layout nesting
// works (every route segment nests INSIDE every ancestor layout; a route
// group changes URL structure only, not the layout tree above it) rather
// than assumed. This file's only job is the minimal centered-card frame
// login/page.tsx renders its content into.
export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      {children}
    </div>
  )
}
