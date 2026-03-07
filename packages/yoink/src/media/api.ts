import { cookies } from 'next/headers'

import { AUTH_TOKEN_COOKIE } from 'src/auth/constants'

import type { MovieDetail } from './movies'
import type { ShowDetail } from './shows'

const BACKEND_URL = `http://localhost:${process.env.BACKEND_PORT ?? 8081}`

export class ApiClient {
  private async fetch<T>(path: string): Promise<T> {
    const cookieStore = await cookies()
    const authToken = cookieStore.get(AUTH_TOKEN_COOKIE)?.value

    const res = await fetch(`${BACKEND_URL}${path}`, {
      headers: authToken ? { Cookie: `${AUTH_TOKEN_COOKIE}=${authToken}` } : {},
      cache: 'no-store',
    })

    if (!res.ok) {
      throw new Error(`API ${path} returned ${res.status}`)
    }

    return res.json() as Promise<T>
  }

  async getMovieById(tmdbId: string): Promise<MovieDetail> {
    return this.fetch(`/movies/${tmdbId}`)
  }

  async getShowById(tvdbId: string): Promise<ShowDetail> {
    return this.fetch(`/shows/${tvdbId}`)
  }
}
