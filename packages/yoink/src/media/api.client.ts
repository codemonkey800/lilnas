interface DownloadMovieOpts {
  releaseGuid?: string
  indexerId?: number
}

class ApiClient {
  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`/api${path}`, init)
    if (!res.ok) throw new Error(`API ${path} returned ${res.status}`)
    return res.json() as Promise<T>
  }

  async requestMovieDownload(
    tmdbId: number,
    opts?: DownloadMovieOpts,
  ): Promise<void> {
    await this.fetch('/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaType: 'movie', tmdbId, ...opts }),
    })
  }

  async requestShowDownload(tvdbId: number, scope: 'series'): Promise<void>
  async requestShowDownload(
    tvdbId: number,
    scope: 'season',
    opts: { seasonNumber: number },
  ): Promise<void>
  async requestShowDownload(
    tvdbId: number,
    scope: 'episode',
    opts: { episodeId: number },
  ): Promise<void>
  async requestShowDownload(
    tvdbId: number,
    scope: 'series' | 'season' | 'episode',
    opts?: { seasonNumber?: number; episodeId?: number },
  ): Promise<void> {
    await this.fetch('/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaType: 'show', tvdbId, scope, ...opts }),
    })
  }
}

export const api = new ApiClient()
