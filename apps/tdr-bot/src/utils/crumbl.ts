import axios from 'axios'
import * as cheerio from 'cheerio'
import { EmbedBuilder, MessageCreateOptions } from 'discord.js'

interface CrumblCookieProduct {
  name: string
  aerialImage: string
  newAerialImage: string
  description: string
  calorieInformation: {
    perServing: string | null
  }
}

interface CrumblMenuItem {
  dessert: CrumblCookieProduct
  highlightTag: string | null
}

interface CrumblMenuSection {
  items: CrumblMenuItem[]
  name: string
  sectionHighlightTag: string | null
  description: string | null
}

interface CrumblSSRData {
  props: {
    pageProps: {
      products: {
        classicMenu?: CrumblMenuSection
        rotatingMenu?: CrumblMenuSection
      }
    }
  }
}

async function getWeeklyCookies(): Promise<CrumblCookieProduct[]> {
  const response = await axios.get<string>('https://crumblcookies.com')
  const $ = cheerio.load(response.data)

  const data = JSON.parse(
    $('#__NEXT_DATA__').html() || 'null',
  ) as CrumblSSRData | null

  const products = data?.props.pageProps.products
  const rotating = products?.rotatingMenu?.items ?? []
  const classics = products?.classicMenu?.items ?? []

  return [...rotating, ...classics].map(item => item.dessert)
}

const DISCORD_MAX_EMBEDS = 10

type WeeklyCookiesMessage = Pick<MessageCreateOptions, 'content' | 'embeds'>

export async function getWeeklyCookiesMessages({
  showEmbeds,
}: {
  showEmbeds?: boolean
} = {}): Promise<WeeklyCookiesMessage[]> {
  const cookies = await getWeeklyCookies()

  if (!showEmbeds) {
    const content = ['Weekly Crumbl Cookies']
    for (const cookie of cookies) {
      content.push(`  - ${cookie.name}`)
    }
    return [{ content: content.join('\n') }]
  }

  const allEmbeds = cookies.map(cookie => {
    let embed = new EmbedBuilder()
      .setTitle(cookie.name)
      .setImage(cookie.aerialImage)
      .setThumbnail(cookie.newAerialImage)
      .setDescription(cookie.description)

    if (cookie.calorieInformation.perServing !== null) {
      embed = embed.addFields({
        name: 'Calories',
        value: cookie.calorieInformation.perServing,
      })
    }

    return embed
  })

  const totalParts = Math.ceil(allEmbeds.length / DISCORD_MAX_EMBEDS)
  const paginated = totalParts > 1

  const messages: WeeklyCookiesMessage[] = []
  for (let i = 0; i < allEmbeds.length; i += DISCORD_MAX_EMBEDS) {
    const part = Math.floor(i / DISCORD_MAX_EMBEDS) + 1
    const chunk = allEmbeds.slice(i, i + DISCORD_MAX_EMBEDS)
    messages.push({
      content: paginated
        ? `Weekly Crumbl Cookies (Part ${part} of ${totalParts})`
        : 'Weekly Crumbl Cookies',
      embeds: chunk,
    })
  }

  return messages
}

/** @deprecated Use getWeeklyCookiesMessages instead */
export async function getWeeklyCookiesMessage({
  showEmbeds,
}: {
  showEmbeds?: boolean
} = {}): Promise<WeeklyCookiesMessage> {
  const [first] = await getWeeklyCookiesMessages({ showEmbeds })
  return first
}
