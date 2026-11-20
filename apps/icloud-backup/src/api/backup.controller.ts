import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common'

import { CurrentUser } from 'src/auth/current-user.decorator'
import type { ForwardedUser } from 'src/auth/forwarded-user'
import { JobsService } from 'src/jobs/jobs.service'
import {
  type BackupView,
  CodeBodySchema,
  PasswordBodySchema,
  StartBackupBodySchema,
} from 'src/shared/contract'

import { JobUserService } from './job-user.service'
import { parseBody } from './parse-body'
import { RequestedWithGuard } from './requested-with.guard'

// Nothing here logs or echoes a request body: the password and code routes
// carry secrets. JobsService conflicts are Nest ConflictExceptions and pass
// through as 409.
@Controller('backup')
@UseGuards(RequestedWithGuard)
export class BackupController {
  constructor(
    private readonly jobs: JobsService,
    private readonly users: JobUserService,
  ) {}

  @Get()
  async view(@CurrentUser() user: ForwardedUser): Promise<BackupView> {
    return this.jobs.getView(await this.users.resolve(user))
  }

  @Post('start')
  @HttpCode(200)
  async start(
    @CurrentUser() user: ForwardedUser,
    @Body() body: unknown,
  ): Promise<BackupView> {
    const { appleId } = parseBody(StartBackupBodySchema, body)
    return this.jobs.start(await this.users.resolve(user), appleId)
  }

  @Post('sync')
  @HttpCode(200)
  async sync(@CurrentUser() user: ForwardedUser): Promise<BackupView> {
    return this.jobs.sync(await this.users.resolve(user))
  }

  @Post('password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async password(
    @CurrentUser() user: ForwardedUser,
    @Body() body: unknown,
  ): Promise<BackupView> {
    const { password } = parseBody(PasswordBodySchema, body)
    return this.jobs.submitPassword(await this.users.resolve(user), password)
  }

  @Post('code')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async code(
    @CurrentUser() user: ForwardedUser,
    @Body() body: unknown,
  ): Promise<BackupView> {
    const { code } = parseBody(CodeBodySchema, body)
    return this.jobs.submitCode(await this.users.resolve(user), code)
  }

  @Post('cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() user: ForwardedUser): Promise<BackupView> {
    return this.jobs.cancel(await this.users.resolve(user))
  }

  @Post('immich-password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async immichPassword(
    @CurrentUser() user: ForwardedUser,
  ): Promise<{ password: string }> {
    return this.jobs.newImmichPassword(await this.users.resolve(user))
  }
}
