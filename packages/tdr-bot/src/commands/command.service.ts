import { DownloadClient } from '@lilnas/utils/download/client'
import { TIME_REGEX } from '@lilnas/utils/download/schema'
import { DownloadJobStatus } from '@lilnas/utils/download/types'
import { isBefore } from '@lilnas/utils/download/utils'
import { isValidURL } from '@lilnas/utils/url'
import { Injectable, Logger } from '@nestjs/common'
import * as fs from 'fs-extra'
import _ from 'lodash'
import { nanoid } from 'nanoid'
import {
  BooleanOption,
  Context,
  NumberOption,
  Options,
  SlashCommand,
  type SlashCommandContext,
  StringOption,
} from 'necord'
import { Docker } from 'node-docker-api'

import { getWeeklyCookiesMessage } from 'src/utils/crumbl'

class ShowDetailsDto {
  @BooleanOption({
    name: 'show-details',
    description: 'Show image + details for each cookie',
  })
  showDetails!: boolean | null
}

class DownloadDto {
  @StringOption({
    name: 'url',
    description: 'URL to download from',
    required: true,
  })
  url!: string

  @StringOption({
    name: 'start',
    description: 'Start time for download',
  })
  start!: string | null

  @StringOption({
    name: 'end',
    description: 'End time for download',
  })
  end!: string | null
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

  @SlashCommand({
    name: 'download',
    description: 'Downloads from a URL and sends it in Discord',
  })
  async download(
    @Context() [interaction]: SlashCommandContext,
    @Options() { end, start, url }: DownloadDto,
  ) {
    const id = nanoid()
    this.logger.log(
      {
        id,
        command: '/download',
        url,
        start,
        end,
        user: interaction.user.username,
      },
      'User used command',
    )

    if ((!start && end) || (start && !end)) {
      this.logger.log({ id, start, end }, 'Start or End time is missing')

      interaction.reply(
        'you need to provide both a start and end time, or remove one',
      )
      return
    }

    if (start && !TIME_REGEX.test(start)) {
      this.logger.log(
        { id, start, end },
        'Start time needs to be formatted correctly',
      )

      interaction.reply('start time needs to be in the format 00:00:00')
      return
    }

    if (end && !TIME_REGEX.test(end)) {
      this.logger.log(
        { id, start, end },
        'End time needs to be formatted correctly',
      )

      interaction.reply('end time needs to be in the format 00:00:00')
      return
    }

    if (start && end && !isBefore(start, end)) {
      this.logger.log({ id, start, end }, 'End time')

      interaction.reply('end time must be after start time')
      return
    }

    if (!isValidURL(url)) {
      this.logger.log({ id, url }, 'url is invalid')

      interaction.reply('url is invalid')
      return
    }

    const client = DownloadClient.dockerInstance

    this.logger.log({ id }, 'creating job')
    let job = await client.createVideoJob({
      url,
      ...(start && end ? { start, end } : {}),
    })

    this.logger.log({ id, job }, 'created job')

    const jobId = job.id

    const checkJob = async () => {
      job = await client.getVideoJob(jobId)
      const urls = job.downloadUrls ?? []

      if (job.status === DownloadJobStatus.Completed && urls.length > 0) {
        const files: string[] = []
        const dir = `/tdr-videos/${jobId}`
        await fs.ensureDir(dir)
        this.logger.log({ id, job, dir }, 'download job completed')

        this.logger.log({ id, job, urls }, 'downloading files')
        await Promise.all(
          urls.map(async url => {
            const file = url.split('/').at(-1) ?? ''
            const fullFile = `${dir}/${file}`
            files.push(fullFile)

            const fileStream = fs.createWriteStream(fullFile)
            const stream = new WritableStream({
              write(chunk) {
                fileStream.write(chunk)
              },
            })

            const response = await fetch(url)
            response.body?.pipeTo(stream)
          }),
        )

        this.logger.log({ id, job, files }, 'downloaded files')

        await interaction.reply({ files })
        return
      }

      if (job.status === DownloadJobStatus.Failed) {
        this.logger.log({ id, job }, 'download job failed')
        await interaction.reply('downloading video failed')
        return
      }

      if (job.status === DownloadJobStatus.Cancelled) {
        this.logger.log({ id, job }, 'job still pending, scheduling next check')
        await interaction.reply('downloading video failed')
        return
      }

      this.logger.log({ id, job }, 'job still pending, scheduling next check')
      setTimeout(checkJob, 2000)
    }

    checkJob()
  }
}
