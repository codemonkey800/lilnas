import { getServices } from 'src/utils'

export async function list() {
  const services = await getServices()
  console.log(services.join('\n'))
}
