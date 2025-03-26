import { Inject, Injectable, Logger } from '@nestjs/common'
import _ from 'lodash'
import { Client } from 'minio'
import {
  BooleanOption,
  Context,
  NumberOption,
  Options,
  SlashCommand,
  type SlashCommandContext,
} from 'necord'
import { MINIO_CONNECTION } from 'nestjs-minio'
import { Docker } from 'node-docker-api'

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

interface ContainerData {
  Names: string[]
}

@Injectable()
export class CommandsService {
  private readonly logger = new Logger(CommandsService.name)

  constructor(@Inject(MINIO_CONNECTION) private readonly minioClient: Client) {}

  @SlashCommand({
    name: 'cookies',
    description: 'Show list of weekly crumbl cookies',
  })
  async onCookies(
    @Context() [interaction]: SlashCommandContext,
    @Options() { showDetails }: ShowDetailsDto,
  ) {
    this.logger.log(
      { command: '/cookies', user: interaction.user.username },
      'User used command',
    )

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

    this.logger.log(
      {
        command: '/flip-coin',
        user: interaction.user.username,
        result,
      },
      'User used command',
    )

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
    const randomNum = _.random(1, roundedSides)

    this.logger.log(
      {
        command: '/roll-dice',
        user: interaction.user.username,
        sides: roundedSides,
        randomNum,
      },
      'User used command',
    )

    await interaction.reply(`Rolled a ${randomNum} from a d${roundedSides}`)
  }

  @SlashCommand({
    name: 'restart',
    description: 'Restarts TDR bot',
  })
  async restart(@Context() [interaction]: SlashCommandContext) {
    this.logger.log(
      {
        command: '/restart',
        user: interaction.user.username,
      },
      'User used command',
    )

    const docker = new Docker({ socketPath: '/var/run/docker.sock' })
    const containers = await docker.container.list()
    const tdrBotContainer = containers.find(container => {
      const data = container.data as ContainerData
      return data.Names.some(name => name.includes('tdr-bot'))
    })

    if (tdrBotContainer) {
      await interaction.reply('Restarting TDR bot <:Sadge:781403152258826281>')
      await tdrBotContainer.restart()
    }
  }
}
