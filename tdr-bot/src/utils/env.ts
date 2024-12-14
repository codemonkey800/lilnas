export type EnvKey =
  | 'BACKEND_PORT'
  | 'DISCORD_API_TOKEN'
  | 'DISCORD_CLIENT_ID'
  | 'DISCORD_DEV_GUILD_ID'
  | 'FRONTEND_PORT'
  | 'NODE_ENV'
  | 'OPENAI_API_KEY'
  | 'TAVILY_API_KEY'

export function env(key: EnvKey, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue

  if (value == null) {
    const message = `${key} not defined`
    console.error(message)
    throw new Error(message)
  }

  return value
}
