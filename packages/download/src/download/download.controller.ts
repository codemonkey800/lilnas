import { CreateDownloadJobInputSchema } from '@lilnas/utils/download/schema'
import type {
  DownloadJob,
  GetDownloadJobResponse,
} from '@lilnas/utils/download/types'
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import { createZodDto } from 'nestjs-zod'

import { DownloadService } from './download.service'
import { DownloadSchedulerService } from './download-scheduler.service'
import { DownloadStateService } from './download-state.service'

class CreateJobInputDto extends createZodDto(CreateDownloadJobInputSchema) {}

@Controller('/download')
export class DownloadController {
  constructor(
    private downloadService: DownloadService,
    private downloadSchedulerService: DownloadSchedulerService,
    private downloadStateService: DownloadStateService,
  ) {}

  private getJobResponse(job: DownloadJob): GetDownloadJobResponse {
    return {
      description: job.description,
      downloadUrls: job.downloadUrls,
      id: job.id,
      status: job.status,
      timeRange: job.timeRange,
      title: job.title,
      type: job.type,
      url: job.url,
    }
  }

  @Get('/videos/:id')
  getVideoJob(@Param('id') id: string): GetDownloadJobResponse {
    const job = this.downloadStateService.jobs.get(id)

    if (!job) {
      throw new HttpException(
        {
          status: HttpStatus.NOT_FOUND,
          error: 'Job not found',
        },
        HttpStatus.NOT_FOUND,
      )
    }

    return this.getJobResponse(job)
  }

  @Post('/videos')
  async createVideoJob(
    @Body() input: CreateJobInputDto,
  ): Promise<GetDownloadJobResponse> {
    const job = await this.downloadService.createVideoDownloadJob(input)
    return this.getJobResponse(job)
  }

  @Patch('/videos/:id/cancel')
  cancelVideoJob(@Param('id') id: string): GetDownloadJobResponse {
    try {
      const job = this.downloadService.cancelVideoDownloadJob(id)
      return this.getJobResponse(job)
    } catch (err) {
      throw new HttpException(
        {
          status: HttpStatus.NOT_FOUND,
          error: 'Job not found',
        },
        HttpStatus.NOT_FOUND,
        { cause: err },
      )
    }
  }
}
