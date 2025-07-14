import { Controller, Get, Inject, Logger } from '@nestjs/common'
import { Client } from 'minio'
import { MINIO_CONNECTION } from 'nestjs-minio'

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name)

  constructor(@Inject(MINIO_CONNECTION) private readonly minioClient: Client) {}

  @Get()
  async health() {
    const timestamp = new Date().toISOString()

    // Check MinIO connectivity
    let minioStatus = 'disconnected'
    try {
      // Simple connectivity check - list buckets with timeout
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('MinIO health check timeout')), 3000),
      )

      await Promise.race([this.minioClient.listBuckets(), timeout])

      minioStatus = 'connected'
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'MinIO health check failed',
      )
      minioStatus = 'disconnected'
    }

    const response = {
      status: minioStatus === 'connected' ? 'ok' : 'degraded',
      timestamp,
      services: {
        minio: minioStatus,
      },
    }

    // Log health check for debugging if needed
    this.logger.debug({ response }, 'Health check performed')

    return response
  }
}
