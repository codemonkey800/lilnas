import { Client, IntentsBitField } from 'discord.js'
import * as dotenv from 'dotenv'
import fs from 'fs/promises'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '.env') })

interface Emoji {
  id: string
  name: string
  animated: boolean
}

async function main() {
  const client = new Client({
    intents: [IntentsBitField.Flags.Guilds],
  })

  client.login(process.env.API_TOKEN)

  await new Promise((resolve) => client.once('ready', resolve))

  const emojis: Emoji[] = []

  client.guilds.cache.forEach((guild) => {
    guild.emojis.cache.forEach((emoji) => {
      if (emoji.name) {
        emojis.push({
          id: emoji.id,
          name: emoji.name ?? 'no',
          animated: emoji.animated ?? false,
        })
      } else {
        console.log(`emoji ${emoji.id} has no name`)
      }
    })
  })

  await fs.writeFile('emojis.json', JSON.stringify(emojis, null, 2))
  await client.destroy()
}

main()
