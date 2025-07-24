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
  Logger,
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
  private logger = new Logger(DownloadController.name)

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
    const action = 'getVideoJob'
    const startTime = Date.now()

    this.logger.log(
      { action, jobId: id },
      'GET /videos/:id - Retrieving video job',
    )

    const job = this.downloadStateService.jobs.get(id)

    if (!job) {
      const duration = Date.now() - startTime
      this.logger.warn(
        {
          action,
          jobId: id,
          duration,
          statusCode: HttpStatus.NOT_FOUND,
          totalJobs: this.downloadStateService.jobs.size,
        },
        'Job not found',
      )

      throw new HttpException(
        {
          status: HttpStatus.NOT_FOUND,
          error: 'Job not found',
        },
        HttpStatus.NOT_FOUND,
      )
    }

    const sanitizedUrl = job.url.split('?')[0]
    const duration = Date.now() - startTime
    const response = this.getJobResponse(job)

    this.logger.log(
      {
        action,
        jobId: id,
        url: sanitizedUrl,
        status: job.status,
        duration,
        statusCode: HttpStatus.OK,
        hasTitle: !!response.title,
        hasDescription: !!response.description,
        hasDownloadUrls: !!response.downloadUrls?.length,
      },
      'Video job retrieved successfully',
    )

    return response
  }

  @Post('/videos')
  async createVideoJob(
    @Body() input: CreateJobInputDto,
  ): Promise<GetDownloadJobResponse> {
    const action = 'createVideoJob'
    const startTime = Date.now()
    const sanitizedUrl = input.url.split('?')[0]

    this.logger.log(
      {
        action,
        url: sanitizedUrl,
        hasTimeRange: !!input.timeRange,
        timeRange: input.timeRange,
        currentJobs: this.downloadStateService.jobs.size,
        queueSize: this.downloadStateService.queue.size(),
      },
      'POST /videos - Creating new video download job',
    )

    try {
      const job = await this.downloadService.createVideoDownloadJob(input)
      const duration = Date.now() - startTime
      const response = this.getJobResponse(job)

      this.logger.log(
        {
          action,
          jobId: job.id,
          url: sanitizedUrl,
          status: job.status,
          duration,
          statusCode: HttpStatus.CREATED,
          totalJobs: this.downloadStateService.jobs.size,
          queueSize: this.downloadStateService.queue.size(),
        },
        'Video download job created successfully',
      )

      return response
    } catch (err) {
      const duration = Date.now() - startTime
      const error = err instanceof Error ? err.message : String(err)

      this.logger.error(
        {
          action,
          url: sanitizedUrl,
          error,
          duration,
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        },
        'Failed to create video download job',
      )

      throw err
    }
  }

  @Patch('/videos/:id/cancel')
  cancelVideoJob(@Param('id') id: string): GetDownloadJobResponse {
    const action = 'cancelVideoJob'
    const startTime = Date.now()

    this.logger.log(
      {
        action,
        jobId: id,
        totalJobs: this.downloadStateService.jobs.size,
        inProgressJobs: this.downloadStateService.inProgressJobs.size,
      },
      'PATCH /videos/:id/cancel - Canceling video job',
    )

    try {
      const job = this.downloadService.cancelVideoDownloadJob(id)
      const duration = Date.now() - startTime
      const sanitizedUrl = job.url.split('?')[0]
      const response = this.getJobResponse(job)

      this.logger.log(
        {
          action,
          jobId: id,
          url: sanitizedUrl,
          oldStatus: job.status === 'cancelling' ? 'in_progress' : job.status, // Status was already updated
          newStatus: job.status,
          duration,
          statusCode: HttpStatus.OK,
          inProgressJobsRemaining:
            this.downloadStateService.inProgressJobs.size,
        },
        'Video job cancellation initiated successfully',
      )

      return response
    } catch (err) {
      const duration = Date.now() - startTime
      const error = err instanceof Error ? err.message : String(err)

      this.logger.warn(
        {
          action,
          jobId: id,
          error,
          duration,
          statusCode: HttpStatus.NOT_FOUND,
          totalJobs: this.downloadStateService.jobs.size,
        },
        'Failed to cancel video job - job not found or not started',
      )

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
