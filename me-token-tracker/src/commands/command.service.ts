import { Injectable, Logger } from '@nestjs/common'
import dedent from 'dedent'
import { Client } from 'discord.js'
import { Context, SlashCommand, SlashCommandContext } from 'necord'

import { getMagicEdenTokenPrice, setTokenPriceActivity } from 'src/utils/token'

@Injectable()
export class CommandsService {
  private readonly logger = new Logger(CommandsService.name)

  constructor(private readonly client: Client) {}

  @SlashCommand({
    name: 'me-token-price',
    description: 'Get current price of the Magic Eden token',
  })
  async onCookies(@Context() [interaction]: SlashCommandContext) {
    const price = await getMagicEdenTokenPrice()

    this.logger.log({
      info: 'Sending price status message',
      user: interaction.user.username,
      price,
    })

    await interaction.reply(dedent`
      the price is currently ${price}

      <https://www.coingecko.com/en/coins/magic-eden>
    `)

    await setTokenPriceActivity(this.client, price)
  }
}
