import { tool } from '@langchain/core/tools'
import dayjs from 'dayjs'
import { z } from 'zod'

import { RadarrService } from 'src/media/services/radarr.service'
import { SonarrService } from 'src/media/services/sonarr.service'

export const dateTool = tool(() => dayjs().format('MMMM DD, YYYY hh:mm:ss A'), {
  name: 'get_date',
  description:
    'Gets the current PST date in the format <Month> <Day>, <Year> <Hour>:<Minute>:<Second> [AM/PM]',
})

export const createMediaTools = (
  radarrService: RadarrService,
  sonarrService: SonarrService,
) => {
  const listMoviesTool = tool(
    async () => {
      try {
        // Get complete movie library from Radarr
        const allMovies = await radarrService.getLibraryMovies()

        // Transform to compact JSON format
        const moviesData = allMovies.map(movie => ({
          title: movie.title,
          year: movie.year,
          hasFile: movie.hasFile,
          monitored: movie.monitored,
          sizeGB: movie.sizeOnDisk
            ? Math.round((movie.sizeOnDisk / (1024 * 1024 * 1024)) * 10) / 10
            : null,
          tmdbId: movie.tmdbId,
          genres: movie.genres,
          status: movie.hasFile
            ? 'downloaded'
            : movie.monitored
              ? 'missing'
              : 'unmonitored',
        }))

        return JSON.stringify({
          total: allMovies.length,
          movies: moviesData,
        })
      } catch (error) {
        return JSON.stringify({
          error: `Error retrieving movies: ${error instanceof Error ? error.message : 'Unknown error'}`,
        })
      }
    },
    {
      name: 'list_movies',
      description:
        'Get the complete movie library as JSON data with status information',
      schema: z.object({}),
    },
  )

  const listShowsTool = tool(
    async () => {
      try {
        // Get complete TV shows library from Sonarr
        const allShows = await sonarrService.getLibrarySeries()

        // Transform to compact JSON format
        const showsData = allShows.map(show => {
          const stats = show.statistics
          return {
            title: show.title,
            year: show.year,
            monitored: show.monitored,
            episodeFileCount: stats?.episodeFileCount || 0,
            totalEpisodeCount: stats?.totalEpisodeCount || 0,
            tvdbId: show.tvdbId,
            genres: show.genres,
            network: show.network,
            status:
              stats && stats.episodeFileCount > 0
                ? 'downloaded'
                : show.monitored
                  ? 'missing'
                  : 'unmonitored',
            ended: show.ended,
          }
        })

        return JSON.stringify({
          total: allShows.length,
          shows: showsData,
        })
      } catch (error) {
        return JSON.stringify({
          error: `Error retrieving TV shows: ${error instanceof Error ? error.message : 'Unknown error'}`,
        })
      }
    },
    {
      name: 'list_shows',
      description:
        'Get the complete TV shows library as JSON data with episode information',
      schema: z.object({}),
    },
  )

  const getDownloadingMediaTool = tool(
    async () => {
      try {
        const [downloadingMovies, downloadingShows] = await Promise.all([
          radarrService.getDownloadingMovies(),
          sonarrService.getDownloadingEpisodes(),
        ])

        const movieSummary = downloadingMovies
          .map(movie => {
            const progress = movie.progress
              ? ` (${Math.round(movie.progress)}%)`
              : ''
            const size = movie.size
              ? ` ${Math.round(movie.size / (1024 * 1024))}MB`
              : ''
            return `• ${movie.movieTitle} (${movie.movieYear})${progress}${size}`
          })
          .join('\n')

        const showSummary = downloadingShows
          .map(episode => {
            const progress = episode.progressPercent
              ? ` (${Math.round(episode.progressPercent)}%)`
              : ''
            const size = episode.size
              ? ` ${Math.round(episode.size / (1024 * 1024))}MB`
              : ''
            const episodeInfo = `S${episode.seasonNumber?.toString().padStart(2, '0')}E${episode.episodeNumber?.toString().padStart(2, '0')}`
            return `• ${episode.seriesTitle} ${episodeInfo}${progress}${size}`
          })
          .join('\n')

        const totalDownloads =
          downloadingMovies.length + downloadingShows.length

        if (totalDownloads === 0) {
          return '## Currently Downloading\n\nNo active downloads found.'
        }

        return `## Currently Downloading

**Total Active Downloads**: ${totalDownloads}

${downloadingMovies.length > 0 ? `**Movies** (${downloadingMovies.length}):\n${movieSummary}\n` : ''}
${downloadingShows.length > 0 ? `**TV Shows** (${downloadingShows.length}):\n${showSummary}` : ''}`
      } catch (error) {
        return `Error retrieving downloading media: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    },
    {
      name: 'get_downloading_media',
      description: 'Get currently downloading movies and TV shows',
      schema: z.object({}),
    },
  )

  return [listMoviesTool, listShowsTool, getDownloadingMediaTool]
}
