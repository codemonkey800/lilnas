'use client'

import { DownloadType } from '@lilnas/utils/download/types'
import { Tab, Tabs } from '@mui/material'
import { SyntheticEvent, useState } from 'react'

import { DownloadForm } from './DownloadForm'
import type {
  MediaRequestActionResult,
  MediaSearchActionResult,
} from './MediaRequestForm'
import { MediaRequestForm } from './MediaRequestForm'

// Enum *members*, not bare string literals - `DownloadType` is a string
// enum, so `'video'` is not assignable to `DownloadType.Video`, and a tuple
// of members is what keeps this list and the shared vocabulary from
// drifting.
const TAB_VALUES = [
  DownloadType.Video,
  DownloadType.Movie,
  DownloadType.Show,
] as const

type TabValue = (typeof TAB_VALUES)[number]

// Keyed on the whole enum rather than just the tuple's members, so adding a
// DownloadType without giving it a label is a compile error.
const TAB_LABELS: Record<DownloadType, string> = {
  [DownloadType.Movie]: 'Movie',
  [DownloadType.Show]: 'Show',
  [DownloadType.Video]: 'Video',
}

export function HomeTabs({
  createDownload,
  requestMovie,
  requestShow,
  searchMovies,
  searchShows,
}: {
  createDownload: (data: FormData) => Promise<void> | void
  requestMovie: (tmdbId: number) => Promise<MediaRequestActionResult>
  requestShow: (tvdbId: number) => Promise<MediaRequestActionResult>
  searchMovies: (query: string) => Promise<MediaSearchActionResult>
  searchShows: (query: string) => Promise<MediaSearchActionResult>
}) {
  const [tab, setTab] = useState<TabValue>(DownloadType.Video)

  function handleChange(_event: SyntheticEvent, value: TabValue) {
    setTab(value)
  }

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <Tabs centered onChange={handleChange} value={tab}>
        {TAB_VALUES.map(value => (
          <Tab key={value} label={TAB_LABELS[value]} value={value} />
        ))}
      </Tabs>

      {tab === DownloadType.Video && (
        <form action={createDownload} className="flex flex-col gap-3">
          <DownloadForm />
        </form>
      )}

      {tab === DownloadType.Movie && (
        <MediaRequestForm
          mediaType={DownloadType.Movie}
          requestAction={requestMovie}
          searchAction={searchMovies}
        />
      )}

      {tab === DownloadType.Show && (
        <MediaRequestForm
          mediaType={DownloadType.Show}
          requestAction={requestShow}
          searchAction={searchShows}
        />
      )}
    </div>
  )
}
