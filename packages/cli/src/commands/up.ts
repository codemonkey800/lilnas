import { runInteractive, StringArraySchema } from 'src/utils'

export async function up(services: unknown) {
  const parsedServices = StringArraySchema.parse(services)
  runInteractive(`docker-compose up -d ${parsedServices.join(' ')}`)
}
