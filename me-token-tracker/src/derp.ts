import { getMagicEdenTokenPrice } from './utils/token'

async function main() {
  const price = await getMagicEdenTokenPrice()

  console.log('breh', price)
}

main()
