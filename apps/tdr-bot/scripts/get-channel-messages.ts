#!/usr/bin/env tsx
import { ChannelType, Client, IntentsBitField, TextChannel } from 'discord.js'
import * as dotenv from 'dotenv'
import path from 'path'

const ENV_FILE = path.resolve(__dirname, '../.env.dev')
dotenv.config({ path: ENV_FILE })

interface ParsedArgs {
  channel: string
  count: number
  prod: boolean
  json: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2)
  const flags = new Set(args.filter(a => a.startsWith('--')))
  const positional = args.filter(a => !a.startsWith('--'))

  const channel = positional[0]
  if (!channel) {
    console.error(
      'Usage: tsx scripts/get-channel-messages.ts [--prod] [--json] <channel> [count]',
    )
    process.exit(1)
  }

  const countArg = positional[1]
  const count = countArg ? parseInt(countArg, 10) : 20

  if (isNaN(count) || count < 1 || count > 100) {
    console.error('count must be a number between 1 and 100')
    process.exit(1)
  }

  return {
    channel,
    count,
    prod: flags.has('--prod'),
    json: flags.has('--json'),
  }
}

interface SerializedMessage {
  id: string
  timestamp: string
  author: {
    id: string
    username: string
    displayName: string
    bot: boolean
  }
  content: string
  embeds: { title?: string; description?: string; url?: string }[]
  attachments: { id: string; url: string; name: string | null }[]
  reference: { messageId: string | null; channelId: string | null } | null
}

async function main() {
  const { channel: channelArg, count, prod, json } = parseArgs(process.argv)

  const tokenKey = prod
    ? 'DISCORD_SCRIPTS_PROD_TOKEN'
    : 'DISCORD_SCRIPTS_DEV_TOKEN'
  const token = process.env[tokenKey]

  if (!token) {
    console.error(`${tokenKey} is not set in .env.dev`)
    process.exit(1)
  }

  const client = new Client({
    intents: [
      IntentsBitField.Flags.Guilds,
      IntentsBitField.Flags.GuildMessages,
      IntentsBitField.Flags.MessageContent,
    ],
  })

  client.login(token)
  await new Promise(resolve => client.once('ready', resolve))

  if (!json) {
    console.log(`Logged in as ${client.user?.tag} (${prod ? 'prod' : 'dev'})`)
  }

  const guild = client.guilds.cache.first()

  if (!guild) {
    console.error('Bot is not in any guilds')
    await client.destroy()
    process.exit(1)
  }

  await guild.channels.fetch()

  const isId = /^\d+$/.test(channelArg)
  const channel = isId
    ? guild.channels.cache.get(channelArg)
    : guild.channels.cache.find(
        c => c.name === channelArg && c.type === ChannelType.GuildText,
      )

  if (!channel) {
    console.error(`Channel "${channelArg}" not found in guild "${guild.name}"`)
    await client.destroy()
    process.exit(1)
  }

  if (channel.type !== ChannelType.GuildText) {
    console.error(`Channel "${channelArg}" is not a text channel`)
    await client.destroy()
    process.exit(1)
  }

  const textChannel = channel as TextChannel

  let rawMessages
  try {
    rawMessages = await textChannel.messages.fetch({ limit: count })
  } catch (err) {
    console.error(
      'Failed to fetch messages (check bot permissions):',
      err instanceof Error ? err.message : String(err),
    )
    await client.destroy()
    process.exit(1)
  }

  // discord.js returns newest-first; reverse to chronological order
  const messages: SerializedMessage[] = [...rawMessages.values()]
    .reverse()
    .map(msg => ({
      id: msg.id,
      timestamp: msg.createdAt.toISOString(),
      author: {
        id: msg.author.id,
        username: msg.author.username,
        displayName: msg.author.displayName,
        bot: msg.author.bot,
      },
      content: msg.content,
      embeds: msg.embeds.map(e => ({
        title: e.title ?? undefined,
        description: e.description ?? undefined,
        url: e.url ?? undefined,
      })),
      attachments: [...msg.attachments.values()].map(a => ({
        id: a.id,
        url: a.url,
        name: a.name,
      })),
      reference: msg.reference
        ? {
            messageId: msg.reference.messageId ?? null,
            channelId: msg.reference.channelId ?? null,
          }
        : null,
    }))

  if (json) {
    console.log(JSON.stringify(messages, null, 2))
    await client.destroy()
    return
  }

  const DIVIDER = '─'.repeat(48)
  console.log(`\nChannel: #${textChannel.name} (${textChannel.id})`)
  console.log(`Guild:   ${guild.name}`)
  console.log(`Fetched  ${messages.length} message(s) (oldest first)`)
  console.log(DIVIDER)

  for (const msg of messages) {
    const ts = new Date(msg.timestamp).toLocaleString()
    const botTag = msg.author.bot ? ' [BOT]' : ''
    const name =
      msg.author.displayName !== msg.author.username
        ? `${msg.author.displayName} (@${msg.author.username})`
        : msg.author.username

    console.log(`\n[${ts}] ${name} (${msg.author.id})${botTag}`)

    if (msg.reference?.messageId) {
      console.log(`  ↩ reply to message ${msg.reference.messageId}`)
    }

    if (msg.content) {
      for (const line of msg.content.split('\n')) {
        console.log(`  ${line}`)
      }
    }

    for (const embed of msg.embeds) {
      const parts = [embed.title, embed.description, embed.url].filter(Boolean)
      if (parts.length) {
        console.log(`  [embed] ${parts.join(' | ')}`)
      }
    }

    for (const attachment of msg.attachments) {
      console.log(
        `  [attachment] ${attachment.name ?? attachment.id}: ${attachment.url}`,
      )
    }
  }

  console.log(`\n${DIVIDER}`)

  await client.destroy()
}

main()
