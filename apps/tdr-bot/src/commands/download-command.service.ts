import { DownloadClient } from '@lilnas/utils/download/client'
import { TIME_REGEX } from '@lilnas/utils/download/schema'
import {
  DownloadJob,
  DownloadJobStatus,
  isVideo,
} from '@lilnas/utils/download/types'
import { isBefore } from '@lilnas/utils/download/utils'
import { env } from '@lilnas/utils/env'
import { isValidURL } from '@lilnas/utils/url'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { DiscordAPIError, MessageFlags } from 'discord.js'
import * as fs from 'fs-extra'
import { Client } from 'minio'
import { nanoid } from 'nanoid'
import {
  BooleanOption,
  Context,
  Options,
  SlashCommand,
  type SlashCommandContext,
  StringOption,
} from 'necord'
import { MINIO_CONNECTION } from 'nestjs-minio'

import { EnvKeys } from 'src/env'

const DOWNLOAD_URL =
  process.env.NODE_ENV === 'production'
    ? 'https://download.lilnas.io'
    : 'http://download.localhost'

const MAX_ERROR_LENGTH = 1000

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

  @BooleanOption({
    name: 'description',
    description: 'Show video description',
  })
  description!: boolean | null

  @BooleanOption({
    name: 'author',
    description: 'Inclue user who requested the download',
  })
  author!: boolean | null
}

@Injectable()
export class DownloadCommandService {
  private readonly logger = new Logger(DownloadCommandService.name)
  private client = DownloadClient.dockerInstance

  constructor(@Inject(MINIO_CONNECTION) private readonly minioClient: Client) {}

  @SlashCommand({
    name: 'download',
    description: 'Downloads from a URL and sends it in Discord',
  })
  async download(
    @Context() [interaction]: SlashCommandContext,
    @Options() { end, start, url, author, description }: DownloadDto,
  ) {
    const id = nanoid()
    this.logger.log(
      {
        id,
        command: '/download',
        url,
        start,
        end,
        author,
        description,
        user: interaction.user.username,
      },
      'User used command',
    )

    if (await this.hasInvalidInput({ url, start, end, interaction, id })) {
      return
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] })

    // The Discord identity is per-interaction, so it cannot live on the shared
    // `this.client` field - `withDiscordIdentity` hands back a *new* client
    // carrying this user's headers and leaves the shared one untouched.
    //
    // Only `createJob` needs it: attribution is recorded at the moment the job
    // is created. `waitForJob`/`cancelJob` below stay on the plain client
    // because waiting and cancelling don't attribute anything.
    //
    // `globalName` is the display name Discord shows in most surfaces; it is
    // what makes an otherwise opaque handle recognisable to the admin doing the
    // account linking later. It is nullable on the Discord API, hence the
    // `?? undefined`. Note we send `username` (not the display name) as
    // `discordUsername` - the display name rides its own header and is roster
    // enrichment only.
    const client = this.client.withDiscordIdentity({
      discordUserId: interaction.user.id,
      discordUsername: interaction.user.username,
      displayName: interaction.user.globalName ?? undefined,
    })

    this.logger.log({ id }, 'creating job')
    const job = await client.createJob({
      url,
      ...(start && end ? { timeRange: { start, end } } : {}),
    })
    this.logger.log({ id, job }, 'created job')

    await interaction.editReply(
      `download @ <${DOWNLOAD_URL}/downloads/${job.id}>`,
    )

    void this.awaitJob({
      id,
      interaction,
      author: author || author == null ? interaction.user.id : undefined,
      description:
        description && isVideo(job.media) ? job.media.overview : undefined,
      jobId: job.id,
      url,
    }).catch((error: unknown) =>
      this.logger.error({ error, id, jobId: job.id }, 'awaitJob threw'),
    )
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

  private async awaitJob({
    author,
    description,
    id,
    interaction,
    jobId,
    url,
  }: {
    author?: string
    description?: string
    id: string
    interaction: SlashCommandContext[0]
    jobId: string
    url: string
  }): Promise<void> {
    const timeoutMs = Number(env(EnvKeys.DOWNLOAD_JOB_TIMEOUT_MS))
    const signal = AbortSignal.timeout(timeoutMs)

    let job: DownloadJob
    try {
      job = await this.client.waitForJob(jobId, { signal })
    } catch (error) {
      if (signal.aborted) {
        this.logger.log({ id, jobId, timeoutMs }, 'download job timed out')

        await this.cancelQuietly({ id, jobId })

        await this.sendEphemeralNotice({
          content: `download timed out while waiting for <${url}> to finish`,
          id,
          interaction,
          jobId,
        })

        return
      }

      this.logger.error({ error, id, jobId }, 'lost track of download job')

      await this.sendEphemeralNotice({
        content: `download failed for <${url}>: lost track of the job`,
        id,
        interaction,
        jobId,
      })

      return
    }

    if (!isVideo(job.media)) {
      this.logger.error(
        { id, job },
        `Expected a video job but got a '${job.media.type}' job`,
      )
      return
    }

    const media = job.media

    switch (job.status) {
      case DownloadJobStatus.Completed: {
        const urls = media.downloadUrls ?? []

        if (urls.length === 0) {
          await this.sendEphemeralNotice({
            content: `download finished for <${media.sourceUrl}> but produced no files`,
            id,
            interaction,
            jobId,
          })
          return
        }

        this.logger.log({ id, job }, 'download job completed')
        await this.sendFiles({
          author,
          description,
          id,
          interaction,
          job,
        })
        return
      }

      case DownloadJobStatus.Failed: {
        this.logger.log({ id, job }, 'download job failed')

        await this.sendEphemeralNotice({
          content: `download failed for <${media.sourceUrl}>${this.formatJobError(job.error)}`,
          id,
          interaction,
          jobId,
        })

        return
      }

      case DownloadJobStatus.Cancelled: {
        this.logger.log({ id, job }, 'download job cancelled')

        await this.sendEphemeralNotice({
          content: `download cancelled for <${media.sourceUrl}>`,
          id,
          interaction,
          jobId,
        })

        return
      }

      default: {
        // unreachable in practice: waitForJob only ever resolves with a
        // terminal snapshot.
        this.logger.error(
          { id, job },
          `waitForJob resolved with a non-terminal status '${job.status}'`,
        )
        return
      }
    }
  }

  /** Best-effort: a 404 here means the job finished on its own in the meantime. */
  private async cancelQuietly({
    id,
    jobId,
  }: {
    id: string
    jobId: string
  }): Promise<void> {
    try {
      await this.client.cancelJob(jobId)
    } catch (error) {
      this.logger.warn(
        { error, id, jobId },
        'Failed to cancel timed-out download job',
      )
    }
  }

  private formatJobError(error?: string): string {
    if (!error) {
      return ''
    }

    const truncated =
      error.length > MAX_ERROR_LENGTH
        ? `${error.slice(0, MAX_ERROR_LENGTH)}…`
        : error

    return `\n\`\`\`\n${truncated}\n\`\`\``
  }

  private async sendEphemeralNotice({
    content,
    id,
    interaction,
    jobId,
  }: {
    content: string
    id: string
    interaction: SlashCommandContext[0]
    jobId: string
  }) {
    try {
      await interaction.followUp({
        content,
        flags: [MessageFlags.Ephemeral],
      })
    } catch (error) {
      this.logger.warn(
        { error, id, jobId },
        'Failed to send ephemeral download notice',
      )
    }
  }

  private async sendFiles({
    author,
    description = '',
    id,
    interaction,
    job,
  }: {
    author?: string
    description?: string
    id: string
    interaction: SlashCommandContext[0]
    job: DownloadJob
  }) {
    if (!isVideo(job.media)) {
      this.logger.error(
        { id, job },
        `Expected a video job but got a '${job.media.type}' job`,
      )
      return
    }

    const media = job.media
    const urls = media.downloadUrls ?? []
    const files: string[] = []

    const dir = `/tmp/tdr-videos/${job.id}`
    await fs.ensureDir(dir)

    this.logger.log({ id, job, dir, urls }, 'downloading files')

    await Promise.all(
      urls.map((url: string) =>
        this.downloadFile({ dir, files, id, job, url }),
      ),
    )

    this.logger.log({ id, job, files }, 'downloaded files')

    if (interaction.channel?.isSendable()) {
      try {
        await interaction.channel.send({
          files,
          content: [
            media.title ? `[**${media.title}**](<${media.sourceUrl}>)\n` : '',
            author ? `sent by <@${author}>\n` : '',
            description,
          ]
            .filter(Boolean)
            .join(''),
        })
      } catch (error) {
        if (error instanceof DiscordAPIError && error.code === 40005) {
          // File too large for Discord, send direct download links instead
          this.logger.log(
            { id, job, urls, fileCount: files.length },
            'Files too large for Discord, sending direct download links',
          )

          const downloadLinks = urls
            .map((url: string, index: number) => `[Video ${index + 1}](${url})`)
            .join(' • ')

          await interaction.channel.send({
            content: [
              media.title ? `[**${media.title}**](<${media.sourceUrl}>)\n` : '',
              author ? `sent by <@${author}>\n` : '',
              description ? `${description}\n\n` : '',
              downloadLinks,
            ]
              .filter(Boolean)
              .join(''),
          })
        } else {
          // Re-throw other errors to maintain existing error handling
          throw error
        }
      }
    }

    // Clean up temporary files after Discord upload attempt
    try {
      await fs.remove(dir)
      this.logger.log({ id, job, dir }, 'Cleaned up temporary files')
    } catch (error) {
      this.logger.warn(
        { id, job, dir, error },
        'Failed to clean up temporary files',
      )
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
    job: DownloadJob
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
