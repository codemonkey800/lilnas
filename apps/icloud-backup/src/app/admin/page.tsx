import type { JSX } from 'react'

import { AdminPage } from 'src/components/admin-page'

export const metadata = { title: 'Backups · iCloud backup' }

export default function AdminRoute(): JSX.Element {
  return <AdminPage />
}
