'use client'

import { Tab, Tabs } from '@mui/material'
import { SyntheticEvent, useState } from 'react'

import { DownloadForm } from './DownloadForm'
import type {
  MediaRequestActionResult,
  MediaSearchActionResult,
} from './MediaRequestForm'
import { MediaRequestForm } from './MediaRequestForm'

const TAB_VALUES = ['video', 'movie', 'show'] as const

type TabValue = (typeof TAB_VALUES)[number]

const TAB_LABELS: Record<TabValue, string> = {
  movie: 'Movie',
  show: 'Show',
  video: 'Video',
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
  const [tab, setTab] = useState<TabValue>('video')

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

      {tab === 'video' && (
        <form action={createDownload} className="flex flex-col gap-3">
          <DownloadForm />
        </form>
      )}

      {tab === 'movie' && (
        <MediaRequestForm
          mediaType="movie"
          requestAction={requestMovie}
          searchAction={searchMovies}
        />
      )}

      {tab === 'show' && (
        <MediaRequestForm
          mediaType="show"
          requestAction={requestShow}
          searchAction={searchShows}
        />
      )}
    </div>
  )
}
