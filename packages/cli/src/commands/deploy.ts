import { z } from 'zod'

import { runInteractive } from 'src/utils'

const DeployOptionsSchema = z.object({
  command: z.enum(['up', 'down', 'redeploy']),
  services: z.array(z.string()),
})

type DeployOptions = z.infer<typeof DeployOptionsSchema>

async function up(services: string[]) {
  runInteractive(`docker-compose up -d ${services.join(' ')}`)
}

async function down(services: string[]) {
  runInteractive(`docker-compose down --rmi all -v ${services.join(' ')}`)
}

async function redeploy(services: string[]) {
  down(services)
  up(services)
}

type CommandHandler = (services: string[]) => Promise<void>

const COMMAND_MAP: Record<DeployOptions['command'], CommandHandler> = {
  down,
  redeploy,
  up,
}

export async function deploy(payload: unknown) {
  const options = DeployOptionsSchema.parse(payload)
  const handler = COMMAND_MAP[options.command]
  await handler(options.services)
}
