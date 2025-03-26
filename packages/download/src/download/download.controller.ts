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
import { CreateDownloadJobInputSchema } from './schema'
import type { DownloadJob, GetDownloadJobResponse } from './types'

class CreateJobInputDto extends createZodDto(CreateDownloadJobInputSchema) {}

@Controller('/download')
export class DownloadController {
  constructor(private downloadService: DownloadService) {}

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
    try {
      const job = this.downloadService.getVideoDownloadJob(id)
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
