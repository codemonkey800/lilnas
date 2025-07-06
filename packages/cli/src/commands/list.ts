import { getServices } from 'src/utils'

export async function list() {
  const services = await getServices()
  console.log(services.map(service => String(service)).join('\n'))
}
