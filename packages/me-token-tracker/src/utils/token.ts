import { CoinGeckoClient } from 'coingecko-api-v3'

export async function getMagicEdenTokenPrice() {
  const client = new CoinGeckoClient({
    autoRetry: true,
    timeout: 10_000,
  })

  const price = await client.simplePrice({
    ids: 'magic-eden',
    vs_currencies: 'usd',
  })

  return price['magic-eden'].usd
}
