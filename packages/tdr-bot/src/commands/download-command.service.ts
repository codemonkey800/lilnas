import { DownloadClient } from '@lilnas/utils/download/client'
import { TIME_REGEX } from '@lilnas/utils/download/schema'
import {
  DownloadJobStatus,
  GetDownloadJobResponse,
} from '@lilnas/utils/download/types'
import { isBefore } from '@lilnas/utils/download/utils'
import { env } from '@lilnas/utils/env'
import { isValidURL } from '@lilnas/utils/url'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { MessageFlags } from 'discord.js'
import * as fs from 'fs-extra'
import { Client } from 'minio'
import { nanoid } from 'nanoid'
import {
  Context,
  Options,
  SlashCommand,
  type SlashCommandContext,
  StringOption,
} from 'necord'
import { MINIO_CONNECTION } from 'nestjs-minio'

import { EnvKey } from 'src/utils/env'

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

@Injectable()
export class DownloadCommandService {
  private readonly logger = new Logger(DownloadCommandService.name)
  private client = DownloadClient.dockerInstance
  private checkJobIterationMap = new Map<string, number>()

  constructor(@Inject(MINIO_CONNECTION) private readonly minioClient: Client) {}

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

    if (await this.hasInvalidInput({ url, start, end, interaction, id })) {
      return
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] })

    this.logger.log({ id }, 'creating job')
    const job = await this.client.createVideoJob({
      url,
      ...(start && end ? { start, end } : {}),
    })
    this.logger.log({ id, job }, 'created job')

    await interaction.editReply(
      `download @ <https://download.lilnas.io/downloads/${job.id}>`,
    )

    this.checkJobIterationMap.set(job.id, 0)
    this.checkJob({ id, interaction, jobId: job.id })
  }

  private async hasInvalidInput({
    end,
    id,
    interaction,
    start,
    url,
  }: {
    url: string
    start?: string | null
    interaction: SlashCommandContext[0]
    id: string
    end?: string | null
  }): Promise<boolean> {
    if ((!start && end) || (start && !end)) {
      this.logger.log({ id, start, end }, 'Start or End time is missing')

      await interaction.reply({
        content: 'you need to provide both a start and end time, or remove one',
        flags: [MessageFlags.Ephemeral],
      })

      return true
    }

    if (start && !TIME_REGEX.test(start)) {
      this.logger.log(
        { id, start, end },
        'Start time needs to be formatted correctly',
      )

      await interaction.reply({
        content: 'start time needs to be in the format 00:00:00',
        flags: [MessageFlags.Ephemeral],
      })

      return true
    }

    if (end && !TIME_REGEX.test(end)) {
      this.logger.log(
        { id, start, end },
        'End time needs to be formatted correctly',
      )

      await interaction.reply({
        content: 'end time needs to be in the format 00:00:00',
        flags: [MessageFlags.Ephemeral],
      })

      return true
    }

    if (start && end && !isBefore(start, end)) {
      this.logger.log({ id, start, end }, 'End time')

      await interaction.reply({
        content: 'end time must be after start time',
        flags: [MessageFlags.Ephemeral],
      })

      return true
    }

    if (!isValidURL(url)) {
      this.logger.log({ id, url }, 'url is invalid')

      await interaction.reply({
        content: 'url is invalid',
        flags: [MessageFlags.Ephemeral],
      })

      return true
    }

    return false
  }

  private async checkJob({
    jobId,
    id,
    interaction,
  }: {
    id: string
    jobId: string
    interaction: SlashCommandContext[0]
  }) {
    const job = await this.client.getVideoJob(jobId)
    const urls = job.downloadUrls ?? []
    const userId = `<@${interaction.user.id}>`
    const iteration = this.checkJobIterationMap.get(jobId) ?? 0

    if (job.status === DownloadJobStatus.Completed && urls.length > 0) {
      this.logger.log({ id, job }, 'download job completed')
      this.checkJobIterationMap.delete(jobId)
      this.sendFiles({ id, job, interaction })
      return
    }

    if (iteration == +env<EnvKey>('DOWNLOAD_POLL_RETRIES')) {
      this.logger.log(
        { id, job, iteration },
        'download job iteration maxed out',
      )

      this.checkJobIterationMap.delete(jobId)
      this.client.cancelVideoJob(jobId)

      if (interaction.channel?.isSendable()) {
        interaction.channel.send(`${userId} downloaded job iteration maxed out`)
      }

      return
    }

    if (job.status === DownloadJobStatus.Failed) {
      this.logger.log({ id, job }, 'download job failed')

      this.checkJobIterationMap.delete(jobId)

      if (interaction.channel?.isSendable()) {
        interaction.channel.send(`${userId} downloaded job failed ${job.url}`)
      }

      return
    }

    if (job.status === DownloadJobStatus.Cancelled) {
      this.logger.log({ id, job }, 'job still pending, scheduling next check')

      this.checkJobIterationMap.delete(jobId)

      if (interaction.channel?.isSendable()) {
        interaction.channel.send(
          `${userId} downloaded job cancelled ${job.url}`,
        )
      }

      return
    }

    this.logger.log(
      { id, job, iteration },
      'job still pending, scheduling next check',
    )

    this.checkJobIterationMap.set(jobId, iteration + 1)

    setTimeout(
      () =>
        this.checkJob({
          id,
          interaction,
          jobId,
        }),
      +env<EnvKey>('DOWNLOAD_POLL_DURATION_MS'),
    )
  }

  private async sendFiles({
    id,
    interaction,
    job,
  }: {
    id: string
    interaction: SlashCommandContext[0]
    job: GetDownloadJobResponse
  }) {
    const urls = job.downloadUrls ?? []
    const files: string[] = []

    const dir = `/tdr-videos/${job.id}`
    await fs.ensureDir(dir)

    this.logger.log({ id, job, dir, urls }, 'downloading files')

    await Promise.all(
      urls.map(url => this.downloadFile({ dir, files, id, job, url })),
    )

    this.logger.log({ id, job, files }, 'downloaded files')

    if (interaction.channel?.isSendable()) {
      interaction.channel.send({
        files,
        content: [
          job.title ? `[**${job.title}**](<${job.url}>)\n\n` : '',
          job.description ? `${job.description}` : '',
        ]
          .filter(Boolean)
          .join(''),
      })
    }

    return
  }

  private async downloadFile({
    dir,
    files,
    id,
    job,
    url,
  }: {
    dir: string
    files: string[]
    id: string
    job: GetDownloadJobResponse
    url: string
  }) {
    const file = url.split('/').at(-1) ?? ''
    const fullFile = `${dir}/${file}`
    files.push(fullFile)

    const bucket = 'videos'
    const key = `${job.id}/${file}`
    const logArgs = { id, job, bucket, key, output: fullFile }

    this.logger.log(logArgs, 'downloading file')
    await this.minioClient.fGetObject(bucket, key, fullFile)
    this.logger.log(logArgs, 'file downloaded')
  }
}
