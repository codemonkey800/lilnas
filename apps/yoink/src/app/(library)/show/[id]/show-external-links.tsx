import { cns } from '@lilnas/utils/cns'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'

import { type ShowDetail } from 'src/media'

interface ExternalLink {
  label: string
  url: string
}

interface ShowExternalLinksProps {
  show: ShowDetail
}

export function ShowExternalLinks({ show }: ShowExternalLinksProps) {
  const links: ExternalLink[] = []

  if (show.imdbId) {
    links.push({
      label: 'IMDb',
      url: `https://www.imdb.com/title/${show.imdbId}/`,
    })
  }

  if (show.tvdbId) {
    links.push({
      label: 'TVDB',
      url: `https://www.thetvdb.com/dereferrer/series/${show.tvdbId}`,
    })
  }

  if (show.tmdbId) {
    links.push({
      label: 'TMDB',
      url: `https://www.themoviedb.org/tv/${show.tmdbId}`,
    })
  }

  if (show.tvMazeId) {
    links.push({
      label: 'TVMaze',
      url: `https://www.tvmaze.com/shows/${show.tvMazeId}`,
    })
  }

  if (links.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {links.map((link, i) => (
        <a
          key={link.label}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cns(
            'group flex items-center gap-1.5',
            'rounded border border-carbon-600 bg-carbon-800',
            'px-3 py-1.5',
            'font-mono text-xs text-carbon-400',
            'transition-colors hover:border-phosphor-700 hover:text-terminal',
            'animate-fade-in opacity-0',
          )}
          style={{
            animationDelay: `${i * 50}ms`,
            animationFillMode: 'forwards',
          }}
        >
          {link.label}
          <OpenInNewIcon
            sx={{ fontSize: 11 }}
            className="opacity-50 transition-opacity group-hover:opacity-100"
          />
        </a>
      ))}
    </div>
  )
}
