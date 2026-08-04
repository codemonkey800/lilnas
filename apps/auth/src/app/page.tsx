import { fetchMe } from 'src/app/lib/require-session'

import { HomeClient } from './home-client'

// Every authenticated user, admin or not, lands here — matching the design
// mockups' own home page, which shows an admin their account + services +
// an "Admin" link, and never force-redirects. This is a deliberate change
// from the pre-redesign behavior (which sent an admin straight to /admin) —
// fetchMe() itself still redirects an outright unauthenticated visitor to
// /login (the one case this page truly cannot render anything for).
export default async function HomePage() {
  const me = await fetchMe()
  return <HomeClient me={me} />
}
