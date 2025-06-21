import { env } from '@lilnas/utils/env'
import {
  Body,
  Controller,
  Header,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import * as fs from 'fs-extra'
import { Client } from 'minio'
import { MINIO_CONNECTION } from 'nestjs-minio'
import path from 'path'

// Note: We'll handle validation manually in the controller
import { EnvKey } from './utils/env'
import { getErrorMessage } from './utils/error'
import { getLatexTemplate } from './utils/latex'
import { SecureExecutor } from './utils/secure-exec'
import {
  CreateEquationSchema,
  validateLatexSafety,
} from './validation/equation.schema'

@Controller('equations')
@UseGuards(ThrottlerGuard)
export class EquationsController {
  private readonly logger = new Logger(EquationsController.name)
  private readonly secureExecutor = new SecureExecutor()

  // Resource limits
  private static readonly MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB
  private static readonly LATEX_TIMEOUT = 15000 // 15 seconds
  private static readonly MAX_CONCURRENT_JOBS = 3

  private activJobs = new Set<string>()

  constructor(@Inject(MINIO_CONNECTION) private readonly minioClient: Client) {}

  private async logBadFile(file: string) {
    const badFilesDir = '/bad-files'
    await fs.ensureDir(badFilesDir)

    const name = path.basename(path.dirname(file))
    const badFile = path.join(badFilesDir, `${name}.tex`)
    await fs.copyFile(file, badFile)
    this.logger.log({ badFile }, 'Stored bad file')
  }

  private async checkResourceLimits(jobId: string): Promise<void> {
    // Check concurrent job limit
    if (this.activJobs.size >= EquationsController.MAX_CONCURRENT_JOBS) {
      throw new HttpException(
        { info: 'Too many concurrent LaTeX jobs. Please try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    // Check if job already exists
    if (this.activJobs.has(jobId)) {
      throw new HttpException(
        { info: 'LaTeX job already in progress' },
        HttpStatus.CONFLICT,
      )
    }
  }

  private async validateFileSize(filePath: string): Promise<void> {
    try {
      const stats = await fs.stat(filePath)
      if (stats.size > EquationsController.MAX_FILE_SIZE) {
        await fs.remove(filePath)
        throw new HttpException(
          { info: 'Generated file exceeds size limit' },
          HttpStatus.PAYLOAD_TOO_LARGE,
        )
      }
    } catch (err) {
      if (err instanceof HttpException) throw err
      // File doesn't exist yet, which is fine
    }
  }

  private async compileLatexSecure({
    dir,
    latex,
    latexFile,
    pngFile,
    pngTmpFile,
    jobId,
  }: {
    dir: string
    latex: string
    latexFile: string
    pngFile: string
    pngTmpFile: string
    jobId: string
  }) {
    this.logger.log({ jobId }, 'Starting secure LaTeX compilation')

    // Add job to active jobs
    this.activJobs.add(jobId)

    try {
      // Ensure directory exists with proper permissions
      await fs.mkdirp(dir, { mode: 0o750 })

      // Create secure LaTeX content
      const latexContent = getLatexTemplate(latex)

      // Additional runtime safety validation
      const safetyCheck = validateLatexSafety(latex)
      if (!safetyCheck.isValid) {
        throw new HttpException(
          {
            info: 'LaTeX content failed safety checks',
            errors: safetyCheck.errors,
          },
          HttpStatus.BAD_REQUEST,
        )
      }

      this.logger.log({ jobId }, 'Writing secure LaTeX file')
      await fs.writeFile(latexFile, latexContent, { mode: 0o640 })

      // Compile PDF with secure execution
      this.logger.log({ jobId, file: latexFile }, 'Compiling LaTeX to PDF')
      try {
        await this.secureExecutor.compilePdfLatex(latexFile, dir)
      } catch (err) {
        this.logger.error(
          { jobId, file: latexFile, error: getErrorMessage(err) },
          'LaTeX compilation failed',
        )
        await this.logBadFile(latexFile)
        throw new HttpException(
          { info: 'LaTeX compilation failed' },
          HttpStatus.BAD_REQUEST,
        )
      }

      // Check if PNG was generated
      if (!(await fs.pathExists(pngFile))) {
        throw new HttpException(
          { info: 'PNG file was not generated' },
          HttpStatus.INTERNAL_SERVER_ERROR,
        )
      }

      // Validate file size
      await this.validateFileSize(pngFile)

      // Rename to temp file for processing
      this.logger.log({ jobId }, 'Preparing image for processing')
      await fs.rename(pngFile, pngTmpFile)

      // Process image with secure execution
      this.logger.log({ jobId }, 'Processing image with ImageMagick')
      try {
        await this.secureExecutor.convertImage(pngTmpFile, pngFile, dir)
      } catch (err) {
        this.logger.error(
          { jobId, error: getErrorMessage(err) },
          'Image processing failed',
        )
        throw new HttpException(
          { info: 'Image processing failed' },
          HttpStatus.INTERNAL_SERVER_ERROR,
        )
      }

      // Final file size validation
      await this.validateFileSize(pngFile)

      this.logger.log({ jobId }, 'LaTeX compilation completed successfully')
    } finally {
      // Always remove job from active jobs
      this.activJobs.delete(jobId)
    }
  }

  private async cleanupLatex(dir: string) {
    this.logger.log({ dir }, 'Cleaning up latex directory')
    await fs.remove(dir)
  }

  @Post()
  @Header('Content-Type', 'application/json')
  @Throttle({ short: { limit: 3, ttl: 60000 } }) // 3 requests per minute
  async createEquation(@Body() body: unknown) {
    // Validate input with Zod schema
    const validationResult = CreateEquationSchema.safeParse(body)
    if (!validationResult.success) {
      this.logger.warn(
        { errors: validationResult.error.errors },
        'Invalid input received',
      )
      throw new HttpException(
        {
          info: 'Invalid input',
          errors: validationResult.error.errors.map(e => e.message),
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    const validatedBody = validationResult.data
    // Validate authentication
    if (validatedBody.token !== env<EnvKey>('API_TOKEN')) {
      this.logger.warn(
        { ip: 'unknown', timestamp: new Date().toISOString() },
        'Unauthorized equation creation attempt',
      )
      throw new UnauthorizedException('Invalid API token')
    }

    const jobId = `eq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const now = Date.now()

    // Use more secure directory structure
    const baseDir =
      process.env.NODE_ENV === 'production'
        ? '/tmp/equations'
        : '/tmp/equations-dev'
    const dir = path.join(baseDir, jobId)
    const latexFile = path.join(dir, 'equation.tex')
    const pngFile = path.join(dir, 'equation.png')
    const pngTmpFile = path.join(dir, 'equation-tmp.png')

    this.logger.log(
      { jobId, latexLength: validatedBody.latex.length },
      'Starting equation creation',
    )

    try {
      // Check resource limits
      await this.checkResourceLimits(jobId)

      // Compile LaTeX with all security measures
      await this.compileLatexSecure({
        dir,
        latex: validatedBody.latex,
        latexFile,
        pngFile,
        pngTmpFile,
        jobId,
      })

      // Upload to MinIO with error handling
      const bucket = 'equations'
      const filename = `${now}.png`

      try {
        await this.minioClient.fPutObject(bucket, filename, pngFile, {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000', // 1 year cache
          'X-Job-ID': jobId,
        })
      } catch (minioErr) {
        this.logger.error(
          { jobId, error: getErrorMessage(minioErr) },
          'Failed to upload to MinIO',
        )
        throw new HttpException(
          { info: 'Failed to store generated image' },
          HttpStatus.INTERNAL_SERVER_ERROR,
        )
      }

      this.logger.log(
        { jobId, bucket, filename },
        'Successfully stored equation image',
      )

      return {
        jobId,
        bucket,
        file: filename,
        url: `${env('MINIO_PUBLIC_URL')}/${bucket}/${filename}`,
        generatedAt: new Date().toISOString(),
      }
    } catch (err) {
      // Structured error logging
      this.logger.error(
        {
          jobId,
          error: getErrorMessage(err),
          latexPreview: validatedBody.latex.substring(0, 100),
          timestamp: new Date().toISOString(),
        },
        'Equation creation failed',
      )

      // Don't expose internal errors to client
      if (err instanceof HttpException) {
        throw err
      }

      throw new HttpException(
        { info: 'Failed to create equation' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    } finally {
      // Always cleanup, even on error
      try {
        await this.cleanupLatex(dir)
      } catch (cleanupErr) {
        this.logger.warn(
          { jobId, error: getErrorMessage(cleanupErr) },
          'Failed to cleanup temporary files',
        )
      }
    }
  }
}
