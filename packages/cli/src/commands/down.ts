import { runInteractive, StringArraySchema } from 'src/utils'

export async function down(services: unknown) {
  const parsedServices = StringArraySchema.parse(services)
  runInteractive(`docker-compose down --rmi all -v ${parsedServices.join(' ')}`)
}
