#!/usr/bin/env tsx
import { ChannelType, Client, GuildChannel, IntentsBitField } from 'discord.js'
import * as dotenv from 'dotenv'
import path from 'path'

const ENV_FILE = path.resolve(__dirname, '../.env.dev')
dotenv.config({ path: ENV_FILE })

const CHANNELS_TO_CLEAR = ['general', 'tdr-bot-chat', 'food']

async function main() {
  const token = process.env.DISCORD_SCRIPTS_DEV_TOKEN

  if (!token) {
    console.error('DISCORD_SCRIPTS_DEV_TOKEN is not set in .env.dev')
    process.exit(1)
  }

  const client = new Client({
    intents: [IntentsBitField.Flags.Guilds],
  })

  client.login(token)
  await new Promise(resolve => client.once('ready', resolve))
  console.log(`Logged in as ${client.user?.tag}`)

  const guild = client.guilds.cache.first()

  if (!guild) {
    console.error('Bot is not in any guilds')
    await client.destroy()
    process.exit(1)
  }

  await guild.channels.fetch()

  for (const channelName of CHANNELS_TO_CLEAR) {
    const channel = guild.channels.cache.find(
      c => c.name === channelName && c.type === ChannelType.GuildText,
    ) as GuildChannel | undefined

    if (!channel) {
      console.warn(`Channel "${channelName}" not found — skipping`)
      continue
    }

    console.log(`Clearing "${channelName}"...`)
    const clone = await channel.clone()
    await channel.delete()
    await clone.setPosition(channel.rawPosition)
    console.log(`"${channelName}" cleared (recreated as #${clone.name})`)
  }

  await client.destroy()
  console.log('Done.')
}

main()
