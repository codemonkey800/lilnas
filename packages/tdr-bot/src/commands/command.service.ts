import { Injectable, Logger } from '@nestjs/common'
import {
  BooleanOption,
  Context,
  Options,
  SlashCommand,
  SlashCommandContext,
} from 'necord'

import { getWeeklyCookiesMessage } from 'src/utils/crumbl'

class ShowDetailsDto {
  @BooleanOption({
    name: 'show-details',
    description: 'Show image + details for each cookie',
  })
  showDetails!: boolean | null
}

@Injectable()
export class CommandsService {
  private readonly logger = new Logger(CommandsService.name)

  @SlashCommand({
    name: 'cookies',
    description: 'Show list of weekly crumbl cookies',
  })
  async onCookies(
    @Context() [interaction]: SlashCommandContext,
    @Options() { showDetails }: ShowDetailsDto,
  ) {
    this.logger.log({
      command: 'cookies',
      user: interaction.user.username,
    })

    await interaction.reply(
      await getWeeklyCookiesMessage({ showEmbeds: showDetails ?? true }),
    )
  }

  @SlashCommand({
    name: 'flip-coin',
    description: 'Flips a coin',
  })
  async onFlipCoin(@Context() [interaction]: SlashCommandContext) {
    const result = Math.random() <= 0.5 ? 'Heads' : 'Tails'

    this.logger.log({
      command: 'flip-coin',
      user: interaction.user.username,
      result,
    })

    await interaction.reply(`${result}`)
  }
}
