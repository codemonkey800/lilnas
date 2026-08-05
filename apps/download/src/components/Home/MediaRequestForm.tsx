'use client'

import { Search } from '@mui/icons-material'
import { CircularProgress, IconButton, TextField } from '@mui/material'
import { FormEvent, useState } from 'react'

import { MediaResultCard } from './MediaResultCard'

export interface MediaSearchResultItem {
  id: number
  overview?: string
  posterUrl?: string
  title: string
  year?: number
}

export interface MediaSearchActionResult {
  error?: string
  results: MediaSearchResultItem[]
}

export interface MediaRequestActionResult {
  error?: string
}

type MediaType = 'movie' | 'show'

const MEDIA_TYPE_LABEL: Record<MediaType, string> = {
  movie: 'movie',
  show: 'show',
}

export function MediaRequestForm({
  mediaType,
  requestAction,
  searchAction,
}: {
  mediaType: MediaType
  requestAction: (id: number) => Promise<MediaRequestActionResult>
  searchAction: (query: string) => Promise<MediaSearchActionResult>
}) {
  const [query, setQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [results, setResults] = useState<MediaSearchResultItem[] | null>(null)
  const [requestingId, setRequestingId] = useState<number | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<MediaSearchResultItem | null>(null)

  const label = MEDIA_TYPE_LABEL[mediaType]

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmed = query.trim()
    if (!trimmed || isSearching || requestingId !== null) {
      return
    }

    setIsSearching(true)
    setSearchError(null)
    setRequestError(null)
    setResults(null)
    setSearchedQuery(trimmed)

    const response = await searchAction(trimmed)

    setIsSearching(false)

    if (response.error) {
      setSearchError(response.error)
      return
    }

    setResults(response.results)
  }

  async function handleRequest(result: MediaSearchResultItem) {
    if (requestingId !== null) {
      return
    }

    setRequestingId(result.id)
    setRequestError(null)

    const response = await requestAction(result.id)

    setRequestingId(null)

    if (response.error) {
      setRequestError(response.error)
      return
    }

    setConfirmed(result)
  }

  function handleReset() {
    setQuery('')
    setSearchedQuery('')
    setIsSearching(false)
    setSearchError(null)
    setResults(null)
    setRequestingId(null)
    setRequestError(null)
    setConfirmed(null)
  }

  if (confirmed) {
    return (
      <div className="flex w-full max-w-[500px] flex-col items-center gap-3 text-center">
        <p className="rounded bg-green-950/40 p-3 text-green-400">
          Requested &ldquo;{confirmed.title}&rdquo; &mdash; searching for a
          release
        </p>

        <button
          className="text-purple-500 underline"
          onClick={handleReset}
          type="button"
        >
          Request another {label}
        </button>
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-[900px] flex-col items-center gap-4">
      <form className="flex items-center gap-3" onSubmit={handleSearch}>
        <TextField
          disabled={isSearching}
          name="query"
          onChange={event => setQuery(event.target.value)}
          placeholder={`Search for a ${label}...`}
          slotProps={{
            input: {
              className: 'md:!text-2xl min-w-[90vw] md:min-w-[50vw]',
              endAdornment: (
                <IconButton
                  className="!text-xl max-md:!hidden !mb-2"
                  disabled={!query.trim() || isSearching}
                  type="submit"
                >
                  <Search fontSize="large" />
                </IconButton>
              ),
            },
          }}
          value={query}
          variant="standard"
        />
      </form>

      {isSearching && <CircularProgress variant="indeterminate" />}

      {searchError && (
        <p className="whitespace-pre-wrap rounded bg-red-950/40 p-3 text-red-400">
          {searchError}
        </p>
      )}

      {results && results.length === 0 && (
        <p className="text-gray-400">
          No results found for &ldquo;{searchedQuery}&rdquo;.
        </p>
      )}

      {results && results.length > 0 && (
        <div className="flex flex-wrap justify-center gap-4">
          {results.map(result => (
            <MediaResultCard
              disabled={requestingId !== null}
              key={result.id}
              onSelect={handleRequest}
              pending={requestingId === result.id}
              result={result}
            />
          ))}
        </div>
      )}

      {requestError && (
        <p className="whitespace-pre-wrap rounded bg-red-950/40 p-3 text-red-400">
          {requestError}
        </p>
      )}
    </div>
  )
}
