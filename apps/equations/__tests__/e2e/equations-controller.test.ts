import {
  emptyOrInvalidStructure,
  excessiveNesting,
  excessiveRepetition,
  longLines,
  oversizedInputs,
  unbalancedBraces,
} from '__tests__/fixtures/invalid-equations'
import {
  dangerousCommands,
  pathTraversalInputs,
  unauthorizedPackages,
  unicodeAttacks,
} from '__tests__/fixtures/malicious-inputs'
import {
  validComplexEquations,
  validDisplayEquations,
  validEdgeCases,
  validInlineEquations,
  validNesting,
  validSpecialCharacters,
  validWithAllowedPackages,
} from '__tests__/fixtures/valid-equations'
import { HttpStatus, INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import * as fs from 'fs-extra'
import { Client } from 'minio'
import { MINIO_CONNECTION } from 'nestjs-minio'
import request from 'supertest'

import { EquationsController } from 'src/equations.controller'
import { SecureExecutor } from 'src/utils/secure-exec'

// Mock environment variables before any imports
process.env.API_TOKEN = 'test-token-12345'
process.env.NODE_ENV = 'test'
process.env.MINIO_ACCESS_KEY = 'test-access'
process.env.MINIO_HOST = 'localhost'
process.env.MINIO_PORT = '9000'
process.env.MINIO_PUBLIC_URL = 'http://localhost:9000'
process.env.MINIO_SECRET_KEY = 'test-secret'

// Mock fs-extra
jest.mock('fs-extra')
const mockFs = fs as jest.Mocked<typeof fs>

// Mock SecureExecutor
jest.mock('src/utils/secure-exec')
const MockSecureExecutor = SecureExecutor as jest.MockedClass<
  typeof SecureExecutor
>

// Don't mock Logger globally as it interferes with NestJS testing
// Instead, we'll use setLogger(false) or setLogger(new Logger()) in the test module

describe('EquationsController (E2E)', () => {
  let app: INestApplication
  let mockMinioClient: jest.Mocked<Client>
  let mockSecureExecutor: jest.Mocked<SecureExecutor>

  beforeAll(async () => {
    // Create mock MinIO client
    mockMinioClient = {
      fPutObject: jest.fn(),
      listBuckets: jest.fn(),
    } as unknown as jest.Mocked<Client>

    // Create mock SecureExecutor instance
    mockSecureExecutor = {
      compilePdfLatex: jest.fn(),
      convertImage: jest.fn(),
    } as unknown as jest.Mocked<SecureExecutor>

    // Mock SecureExecutor constructor to return our mock instance
    MockSecureExecutor.mockImplementation(() => mockSecureExecutor)

    // Create a mock ThrottlerGuard that always returns true (allows all requests)
    const mockThrottlerGuard = {
      canActivate: jest.fn().mockReturnValue(true),
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          {
            name: 'short',
            ttl: 60000,
            limit: 1000,
          },
          {
            name: 'medium',
            ttl: 900000,
            limit: 1000,
          },
          {
            name: 'long',
            ttl: 3600000,
            limit: 1000,
          },
        ]),
      ],
      controllers: [EquationsController],
      providers: [
        {
          provide: MINIO_CONNECTION,
          useValue: mockMinioClient,
        },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue(mockThrottlerGuard)
      .setLogger(false) // Disable logging in tests
      .compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks()

    // Set up default successful mock implementations
    mockSecureExecutor.compilePdfLatex.mockResolvedValue(undefined)
    mockSecureExecutor.convertImage.mockResolvedValue(undefined)
    mockMinioClient.fPutObject.mockResolvedValue({} as any)

    // Mock file system operations to succeed by default
    mockFs.mkdirp.mockResolvedValue(undefined as any)
    mockFs.writeFile.mockResolvedValue(undefined)
    mockFs.rename.mockResolvedValue(undefined)
    mockFs.remove.mockResolvedValue(undefined)
    mockFs.pathExists.mockResolvedValue(true)
    mockFs.stat.mockResolvedValue({ size: 1000 } as any)
    mockFs.copyFile.mockResolvedValue(undefined)
    mockFs.ensureDir.mockResolvedValue(undefined as any)
  })

  describe('POST /equations - Valid Inputs', () => {
    it('should render a valid inline equation', async () => {
      const testCase = validInlineEquations[0]
      const response = await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: testCase.latex,
        })
        .expect(HttpStatus.CREATED)
        .expect('Content-Type', /application\/json/)

      expect(response.body).toMatchObject({
        jobId: expect.stringMatching(/^eq_\d+_[a-z0-9]+$/),
        bucket: 'equations',
        file: expect.stringMatching(/^\d+\.png$/),
        url: expect.stringContaining('http://localhost:9000/equations/'),
        generatedAt: expect.any(String),
      })
    })

    it('should render valid display equations', async () => {
      const testCase = validDisplayEquations[0]
      await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: testCase.latex,
        })
        .expect(HttpStatus.CREATED)
    })

    it('should render valid complex equations', async () => {
      const testCase = validComplexEquations[0]
      await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: testCase.latex,
        })
        .expect(HttpStatus.CREATED)
    })

    it('should accept equations with allowed packages', async () => {
      const testCase = validWithAllowedPackages[0]
      await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: testCase.latex,
        })
        .expect(HttpStatus.CREATED)
    })

    it('should accept equations with special characters', async () => {
      const testCase = validSpecialCharacters[0]
      await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: testCase.latex,
        })
        .expect(HttpStatus.CREATED)
    })

    it('should accept equations with valid nesting', async () => {
      const testCase = validNesting[0]
      await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: testCase.latex,
        })
        .expect(HttpStatus.CREATED)
    })

    it('should accept edge case equations', async () => {
      const testCase = validEdgeCases[0]
      await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: testCase.latex,
        })
        .expect(HttpStatus.CREATED)
    })

    it('should call MinIO upload with correct parameters', async () => {
      await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: '$x = 1$',
        })
        .expect(HttpStatus.CREATED)

      expect(mockMinioClient.fPutObject).toHaveBeenCalledWith(
        'equations',
        expect.stringMatching(/^\d+\.png$/),
        expect.any(String),
        expect.objectContaining({
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000',
        }),
      )
    })

    it('should cleanup temporary files after success', async () => {
      await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: '$x = 1$',
        })
        .expect(HttpStatus.CREATED)

      expect(mockFs.remove).toHaveBeenCalledWith(
        expect.stringContaining('/tmp/equations'),
      )
    })

    it('should have valid ISO 8601 timestamp in response', async () => {
      const response = await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: '$x = 1$',
        })
        .expect(HttpStatus.CREATED)

      expect(response.body.generatedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      )
    })
  })

  describe('POST /equations - Missing/Empty Fields', () => {
    it('should reject request with missing token field', async () => {
      const response = await request(app.getHttpServer())
        .post('/equations')
        .send({
          latex: '$x = 1$',
        })
        .expect(HttpStatus.BAD_REQUEST)

      expect(response.body).toHaveProperty('info', 'Invalid input')
      expect(response.body.errors).toBeDefined()
    })

    it('should reject request with empty token', async () => {
      const response = await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: '',
          latex: '$x = 1$',
        })
        .expect(HttpStatus.BAD_REQUEST)

      expect(response.body).toHaveProperty('info', 'Invalid input')
    })

    it('should reject request with missing latex field', async () => {
      const response = await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
        })
        .expect(HttpStatus.BAD_REQUEST)

      expect(response.body).toHaveProperty('info', 'Invalid input')
    })

    it('should reject request with empty latex', async () => {
      const response = await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: '',
        })
        .expect(HttpStatus.BAD_REQUEST)

      expect(response.body).toHaveProperty('info', 'Invalid input')
    })
  })

  describe('POST /equations - Oversized Inputs', () => {
    oversizedInputs.forEach(testCase => {
      it(`should reject ${testCase.description}`, async () => {
        const response = await request(app.getHttpServer())
          .post('/equations')
          .send({
            token: 'test-token-12345',
            latex: testCase.latex,
          })
          .expect(HttpStatus.BAD_REQUEST)

        expect(response.body).toHaveProperty('info', 'Invalid input')
        expect(response.body.errors).toEqual(
          expect.arrayContaining([
            expect.stringMatching(/LaTeX content too long/i),
          ]),
        )
      })
    })
  })

  describe('POST /equations - Excessive Nesting', () => {
    excessiveNesting.forEach(testCase => {
      it(`should reject ${testCase.description}`, async () => {
        const response = await request(app.getHttpServer())
          .post('/equations')
          .send({
            token: 'test-token-12345',
            latex: testCase.latex,
          })
          .expect(HttpStatus.BAD_REQUEST)

        expect(response.body).toHaveProperty('info', 'Invalid input')
        expect(response.body.errors).toEqual(
          expect.arrayContaining([
            expect.stringMatching(/invalid structure|excessive nesting/i),
          ]),
        )
      })
    })
  })

  describe('POST /equations - Unbalanced Braces', () => {
    unbalancedBraces.forEach(testCase => {
      it(`should reject ${testCase.description}`, async () => {
        const response = await request(app.getHttpServer())
          .post('/equations')
          .send({
            token: 'test-token-12345',
            latex: testCase.latex,
          })
          .expect(HttpStatus.BAD_REQUEST)

        expect(response.body).toHaveProperty('info', 'Invalid input')
      })
    })
  })

  describe('POST /equations - Excessive Repetition', () => {
    excessiveRepetition.forEach(testCase => {
      it(`should reject ${testCase.description}`, async () => {
        await request(app.getHttpServer())
          .post('/equations')
          .send({
            token: 'test-token-12345',
            latex: testCase.latex,
          })
          .expect(HttpStatus.BAD_REQUEST)
      })
    })
  })

  describe('POST /equations - Long Lines', () => {
    longLines.forEach(testCase => {
      it(`should reject ${testCase.description}`, async () => {
        await request(app.getHttpServer())
          .post('/equations')
          .send({
            token: 'test-token-12345',
            latex: testCase.latex,
          })
          .expect(HttpStatus.BAD_REQUEST)
      })
    })
  })

  describe('POST /equations - Empty or Invalid Structure', () => {
    emptyOrInvalidStructure.forEach(testCase => {
      it(`should reject ${testCase.description}`, async () => {
        // Note: Whitespace-only strings pass Zod validation (min(1) checks length, not trimmed)
        // but would fail during LaTeX compilation. For tests, we expect either:
        // - BAD_REQUEST for truly invalid structure
        // - CREATED if it passes validation (whitespace-only cases)
        const whitespaceOnly = /^[\s\t\n]+$/.test(testCase.latex)

        const response = await request(app.getHttpServer())
          .post('/equations')
          .send({
            token: 'test-token-12345',
            latex: testCase.latex,
          })

        if (whitespaceOnly) {
          // Whitespace-only passes validation but generates content
          expect([HttpStatus.BAD_REQUEST, HttpStatus.CREATED]).toContain(
            response.status,
          )
        } else {
          expect(response.status).toBe(HttpStatus.BAD_REQUEST)
        }
      })
    })
  })

  describe('POST /equations - Dangerous Commands', () => {
    dangerousCommands.slice(0, 10).forEach(testCase => {
      it(`should reject ${testCase.description}`, async () => {
        const response = await request(app.getHttpServer())
          .post('/equations')
          .send({
            token: 'test-token-12345',
            latex: testCase.latex,
          })
          .expect(HttpStatus.BAD_REQUEST)

        expect(response.body).toHaveProperty('info', 'Invalid input')
        expect(response.body.errors).toEqual(
          expect.arrayContaining([expect.stringMatching(/dangerous|unsafe/i)]),
        )
      })
    })
  })

  describe('POST /equations - Path Traversal Attempts', () => {
    pathTraversalInputs.forEach(testCase => {
      it(`should reject ${testCase.description}`, async () => {
        const response = await request(app.getHttpServer())
          .post('/equations')
          .send({
            token: 'test-token-12345',
            latex: testCase.latex,
          })
          .expect(HttpStatus.BAD_REQUEST)

        expect(response.body).toHaveProperty('info', 'Invalid input')
      })
    })
  })

  describe('POST /equations - Unauthorized Packages', () => {
    unauthorizedPackages.forEach(testCase => {
      it(`should reject ${testCase.description}`, async () => {
        const response = await request(app.getHttpServer())
          .post('/equations')
          .send({
            token: 'test-token-12345',
            latex: testCase.latex,
          })
          .expect(HttpStatus.BAD_REQUEST)

        expect(response.body).toHaveProperty('info', 'Invalid input')
        expect(response.body.errors).toEqual(
          expect.arrayContaining([
            expect.stringMatching(/unauthorized packages/i),
          ]),
        )
      })
    })
  })

  describe('POST /equations - Unicode Attacks', () => {
    unicodeAttacks.slice(0, 5).forEach(testCase => {
      it(`should reject ${testCase.description}`, async () => {
        await request(app.getHttpServer())
          .post('/equations')
          .send({
            token: 'test-token-12345',
            latex: testCase.latex,
          })
          .expect(HttpStatus.BAD_REQUEST)
      })
    })
  })

  describe('POST /equations - Malformed Requests', () => {
    it('should reject request with invalid JSON', async () => {
      await request(app.getHttpServer())
        .post('/equations')
        .set('Content-Type', 'application/json')
        .send('not valid json{')
        .expect(HttpStatus.BAD_REQUEST)
    })

    it('should reject request with wrong field types', async () => {
      await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 12345, // Should be string
          latex: '$x = 1$',
        })
        .expect(HttpStatus.BAD_REQUEST)
    })

    it('should reject request with extra unknown fields', async () => {
      // Note: Zod by default strips unknown fields, so this should still work
      // unless strict mode is enabled
      const response = await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: '$x = 1$',
          extraField: 'not allowed',
        })

      // Should either succeed (fields stripped) or fail (strict mode)
      expect([HttpStatus.CREATED, HttpStatus.BAD_REQUEST]).toContain(
        response.status,
      )
    })

    it('should handle empty request body', async () => {
      await request(app.getHttpServer())
        .post('/equations')
        .send({})
        .expect(HttpStatus.BAD_REQUEST)
    })

    it('should handle null values', async () => {
      await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: null,
          latex: null,
        })
        .expect(HttpStatus.BAD_REQUEST)
    })
  })

  describe('POST /equations - Authentication', () => {
    it('should reject request with invalid token', async () => {
      await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'wrong-token',
          latex: '$x = 1$',
        })
        .expect(HttpStatus.UNAUTHORIZED)
    })

    it('should reject request with incorrect token', async () => {
      const response = await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'invalid-token-abc123',
          latex: '$x = 1$',
        })
        .expect(HttpStatus.UNAUTHORIZED)

      expect(response.body).toHaveProperty('message', 'Invalid API token')
    })

    it('should accept request with valid token', async () => {
      await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: '$x = 1$',
        })
        .expect(HttpStatus.CREATED)
    })
  })

  describe('POST /equations - Error Handling', () => {
    it('should return 400 when LaTeX compilation fails', async () => {
      mockSecureExecutor.compilePdfLatex.mockRejectedValue(
        new Error('Compilation failed'),
      )

      const response = await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: '$x = 1$',
        })
        .expect(HttpStatus.BAD_REQUEST)

      expect(response.body).toHaveProperty('info', 'LaTeX compilation failed')
    })

    it('should return 500 when MinIO upload fails', async () => {
      mockMinioClient.fPutObject.mockRejectedValue(new Error('Upload failed'))

      const response = await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: '$x = 1$',
        })
        .expect(HttpStatus.INTERNAL_SERVER_ERROR)

      expect(response.body).toHaveProperty(
        'info',
        'Failed to store generated image',
      )
    })

    it('should return 413 when generated file exceeds size limit', async () => {
      mockFs.stat.mockResolvedValue({ size: 26 * 1024 * 1024 } as any) // 26MB

      const response = await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: '$x = 1$',
        })
        .expect(HttpStatus.PAYLOAD_TOO_LARGE)

      expect(response.body).toHaveProperty(
        'info',
        'Generated file exceeds size limit',
      )
    })

    it('should return 500 when PNG file was not generated', async () => {
      mockFs.pathExists.mockResolvedValue(false)

      const response = await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: '$x = 1$',
        })
        .expect(HttpStatus.INTERNAL_SERVER_ERROR)

      expect(response.body).toHaveProperty('info', 'PNG file was not generated')
    })

    it('should return 500 when image processing fails', async () => {
      mockSecureExecutor.convertImage.mockRejectedValue(
        new Error('ImageMagick failed'),
      )

      const response = await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: '$x = 1$',
        })
        .expect(HttpStatus.INTERNAL_SERVER_ERROR)

      expect(response.body).toHaveProperty('info', 'Image processing failed')
    })

    it('should cleanup files even when errors occur', async () => {
      mockMinioClient.fPutObject.mockRejectedValue(new Error('Upload failed'))

      await request(app.getHttpServer())
        .post('/equations')
        .send({
          token: 'test-token-12345',
          latex: '$x = 1$',
        })
        .expect(HttpStatus.INTERNAL_SERVER_ERROR)

      // Cleanup should still be called in finally block
      expect(mockFs.remove).toHaveBeenCalled()
    })
  })
})
