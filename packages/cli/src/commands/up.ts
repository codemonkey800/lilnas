import { runInteractive, ServicesOptionSchema } from 'src/utils'

export async function up(options: unknown) {
  const { services } = ServicesOptionSchema.parse(options)
  runInteractive(`docker-compose up -d ${services.join(' ')}`)
}
