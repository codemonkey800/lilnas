export interface AppDetails {
  slug: string
  packageName: string
  tokenCount: number
}

export interface TokenRecord {
  id: string
  appSlug: string
  name: string
  description: string | null
  tokenPrefix: string
  createdAt: string
}

export interface AppWithTokens extends AppDetails {
  tokens: TokenRecord[]
}

export interface CreateTokenResponse extends TokenRecord {
  value: string
}

export interface CreateTokenRequest {
  name: string
  description?: string
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
  }

  return res.json() as Promise<T>
}

export const api = {
  listApps: () => apiFetch<AppDetails[]>('/apps'),

  getApp: (slug: string) => apiFetch<AppWithTokens>(`/apps/${slug}`),

  createToken: (slug: string, data: CreateTokenRequest) =>
    apiFetch<CreateTokenResponse>(`/apps/${slug}/tokens`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteToken: (slug: string, tokenId: string) =>
    apiFetch<void>(`/apps/${slug}/tokens/${tokenId}`, { method: 'DELETE' }),
}
