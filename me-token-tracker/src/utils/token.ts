import { CoinGeckoClient } from 'coingecko-api-v3'
import { ActivityType, Client } from 'discord.js'

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

export async function setTokenPriceActivity(client: Client, price: number) {
  client.user?.setActivity(`$${price}`, {
    type: ActivityType.Custom,
  })
}
