import { INestApplication, Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { Client } from 'minio'
import { MINIO_CONNECTION } from 'nestjs-minio'
import request from 'supertest'

import { HealthController } from 'src/health.controller'

describe('HealthController (E2E)', () => {
  let app: INestApplication
  let mockMinioClient: jest.Mocked<Client>

  beforeAll(async () => {
    // Create mock MinIO client
    mockMinioClient = {
      listBuckets: jest.fn(),
    } as unknown as jest.Mocked<Client>

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: MINIO_CONNECTION,
          useValue: mockMinioClient,
        },
      ],
    })
      .setLogger(new Logger())
      .compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('GET /health', () => {
    it('should return status "ok" when MinIO is connected', async () => {
      mockMinioClient.listBuckets.mockResolvedValue([])

      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect('Content-Type', /json/)

      expect(response.body).toMatchObject({
        status: 'ok',
        timestamp: expect.any(String),
        services: {
          minio: 'connected',
        },
      })
    })

    it('should return status "degraded" when MinIO connection fails', async () => {
      mockMinioClient.listBuckets.mockRejectedValue(
        new Error('Connection failed'),
      )

      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect('Content-Type', /json/)

      expect(response.body).toMatchObject({
        status: 'degraded',
        timestamp: expect.any(String),
        services: {
          minio: 'disconnected',
        },
      })
    })

    it('should return status "degraded" when MinIO times out', async () => {
      // Mock a timeout by delaying beyond 3 seconds
      mockMinioClient.listBuckets.mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 3100),
          ),
      )

      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect('Content-Type', /json/)

      expect(response.body).toMatchObject({
        status: 'degraded',
        timestamp: expect.any(String),
        services: {
          minio: 'disconnected',
        },
      })
    }, 5000) // Increase test timeout to allow for the 3s MinIO timeout

    it('should have valid ISO 8601 timestamp', async () => {
      mockMinioClient.listBuckets.mockResolvedValue([])

      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200)

      expect(response.body.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      )
    })

    it('should always return 200 status even when degraded', async () => {
      mockMinioClient.listBuckets.mockRejectedValue(new Error('Failed'))

      await request(app.getHttpServer()).get('/health').expect(200)
    })
  })
})
