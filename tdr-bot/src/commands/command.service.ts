import { Injectable, Logger } from '@nestjs/common'
import { random } from 'lodash'
import {
  BooleanOption,
  Context,
  IntegerOption,
  NumberOption,
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

class SidesDto {
  @NumberOption({
    name: 'sides',
    description: 'Select how many sides you want to roll with',
  })
  sides!: number | null
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

  @SlashCommand({
    name: 'roll-dice',
    description: 'Rolls a dice',
  })
  async onRollDice(
    @Context() [interaction]: SlashCommandContext,
    @Options() { sides }: SidesDto,
  ) {
    const roundedSides = Math.round(sides ?? 6)
    const randomNum = random(1, roundedSides)

    this.logger.log({
      command: 'roll-dice',
      user: interaction.user.username,
      sides: roundedSides,
      randomNum,
    })

    await interaction.reply(`Rolled a ${randomNum} from a d${roundedSides}`)
  }
}
