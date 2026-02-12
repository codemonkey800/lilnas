import { auth } from 'src/auth'
import { DashboardActionItemsList } from 'src/components/dashboard-action-items-list'

import { getMyActionItems } from './check-ins/queries'

// ---------------------------------------------------------------------------
// DashboardActionItems -- server component
// ---------------------------------------------------------------------------

export async function DashboardActionItems() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null

  const items = await getMyActionItems()

  return (
    <section className="flex w-full max-w-md flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight text-text">
        Action Items
      </h2>

      <DashboardActionItemsList items={items} userId={userId} />
    </section>
  )
}
