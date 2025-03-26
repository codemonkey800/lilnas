import { DownloadClient } from '@lilnas/utils/download/client'
import { redirect } from 'next/navigation'

import { DownloadForm } from './DownloadForm'

export function Home() {
  async function createDownload(data: FormData) {
    'use server'

    const url = data.get('url') as string
    const start = data.get('start') as string
    const end = data.get('end') as string

    const client = DownloadClient.localInstance
    const job = await client.createVideoJob({
      url,

      ...(start && end
        ? {
            timeRange: {
              start,
              end,
            },
          }
        : {}),
    })

    redirect(`/downloads/${job.id}`)
  }

  return (
    <div className="flex flex-auto items-center justify-center">
      <form action={createDownload} className="flex flex-col gap-3">
        <DownloadForm />
      </form>
    </div>
  )
}
