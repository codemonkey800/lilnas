/**
 * Formatting utilities for media data presentation
 *
 * Extracted from llm.service.ts for reuse across strategies
 */

/**
 * Format bytes to human-readable file size
 * Extracted from llm.service.ts lines 2905-2911
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * Format time remaining from completion timestamp
 * Extracted from llm.service.ts lines 2913-2932
 */
export function formatTimeRemaining(completionTime: string): string | null {
  try {
    const completion = new Date(completionTime)
    const now = new Date()
    const diffMs = completion.getTime() - now.getTime()

    if (diffMs <= 0) return 'Soon'

    const hours = Math.floor(diffMs / (1000 * 60 * 60))
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

    if (hours > 0) {
      return `${hours}h ${minutes}m`
    } else {
      return `${minutes}m`
    }
  } catch {
    return null
  }
}

/**
 * Format media items as minified JSON for LLM consumption
 * Extracted from llm.service.ts lines 2519-2548
 */
export function formatMediaAsJson(
  items: Array<{
    title: string
    year?: number
    hasFile?: boolean
    tmdbId?: number
    tvdbId?: number
    genres?: string[]
    rating?: number
    overview?: string
    status?: string
    monitored?: boolean
    id?: number
  }>,
): string {
  return JSON.stringify(
    items.map(item => ({
      title: item.title,
      year: item.year,
      hasFile: item.hasFile,
      tmdbId: item.tmdbId || item.tvdbId,
      genres: item.genres || [],
      rating: item.rating,
      overview: item.overview,
      status: item.status,
      monitored: item.monitored,
      id: item.id,
    })),
  )
}
