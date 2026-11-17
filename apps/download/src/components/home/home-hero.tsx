'use client'

import type { JSX } from 'react'

import { useSearchOrDownload } from 'src/components/shell/use-search-or-download'
import { HeroField } from 'src/components/ui/hero-field'

export const HOME_HEADLINE = 'What are we downloading?'

export const HOME_HINT =
  'Movies and shows go to Radarr and Sonarr. Any other link goes to yt-dlp.'

export const HOME_PLACEHOLDER = 'Search a title or paste a link…'

/**
 * The homepage's field. The nav bar's own field is omitted here (two copies of
 * one control on one screen), and both are the same `useSearchOrDownload`: a
 * pasted link goes to yt-dlp, a title goes to `/search`.
 */
export function HomeHero(): JSX.Element {
  const field = useSearchOrDownload()

  return (
    <HeroField
      buttonLabel={field.classification.kind === 'url' ? 'Download' : 'Search'}
      error={field.error}
      formLabel="Search or paste a link"
      hint={HOME_HINT}
      inputLabel="Search or paste a link"
      placeholder={HOME_PLACEHOLDER}
      title={HOME_HEADLINE}
      value={field.value}
      onSubmit={field.submit}
      onValueChange={value => {
        field.setValue(value)
        field.clearError()
      }}
    />
  )
}
