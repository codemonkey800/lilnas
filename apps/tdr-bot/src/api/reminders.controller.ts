import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
  UsePipes,
} from '@nestjs/common'
import { Client, Guild } from 'discord.js'

import { REMINDER_STATUSES, ReminderStatus } from 'src/db/schema'
import { ReminderError, ReminderService } from 'src/reminders/reminder.service'
import { describeSchedule, ReminderSchedule } from 'src/reminders/schedule'

import type {
  CreateReminderBody,
  MemberInfo,
  ReminderView,
  ScheduleBody,
  UpdateReminderBody,
} from './api.types'
import { type ReminderResolver, toReminderView } from './reminder-views'
import {
  createReminderBodySchema,
  previewReminderBodySchema,
  updateReminderBodySchema,
} from './reminders.schema'
import { ZodValidationPipe } from './zod-validation.pipe'

function toError(err: ReminderError): Error {
  const body = { message: err.message, code: err.code }
  switch (err.code) {
    case 'not_found':
      return new NotFoundException(body)
    case 'forbidden':
      return new ForbiddenException(body)
    case 'not_active':
      return new ConflictException(body)
    default:
      return new BadRequestException(body)
  }
}

async function mapErrors<T>(run: () => Promise<T> | T): Promise<T> {
  try {
    return await run()
  } catch (err) {
    throw err instanceof ReminderError ? toError(err) : err
  }
}

function toSchedule(body: ScheduleBody): ReminderSchedule {
  return body.kind === 'once'
    ? { kind: 'once', at: new Date(body.at) }
    : {
        kind: 'recurring',
        cron: body.cron,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
      }
}

@Controller('reminders')
export class RemindersController {
  constructor(
    private readonly reminders: ReminderService,
    private readonly client: Client,
  ) {}

  @Get()
  async list(
    @Query('status') status: string = 'active',
    @Query('userId') userId?: string,
  ): Promise<ReminderView[]> {
    if (status !== 'all' && !REMINDER_STATUSES.includes(status as never)) {
      throw new BadRequestException(`Invalid "status": ${status}`)
    }

    const rows = await this.reminders.list({
      status: status as ReminderStatus | 'all',
      userId: userId || undefined,
    })
    const resolve = this.resolver()
    return rows.map(row => toReminderView(row, resolve))
  }

  @Get('members')
  async members(): Promise<MemberInfo[]> {
    const guild = this.guild()
    const members = await guild.members.fetch()

    return [...members.values()]
      .filter(m => !m.user.bot)
      .map(m => ({
        id: m.id,
        username: m.user.username,
        displayName: m.displayName,
        avatarUrl: m.user.displayAvatarURL() ?? null,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  }

  @Post('preview')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(previewReminderBodySchema))
  preview(@Body() body: { schedule: ScheduleBody }) {
    return mapErrors(() => {
      const schedule = toSchedule(body.schedule)
      const runs = this.reminders.preview(schedule)
      return {
        runs: runs.map(run => run.toISOString()),
        description: describeSchedule(schedule),
      }
    })
  }

  @Post()
  @UsePipes(new ZodValidationPipe(createReminderBodySchema))
  async create(@Body() body: CreateReminderBody): Promise<ReminderView> {
    const guild = this.guild()
    const row = await mapErrors(() =>
      this.reminders.create({
        userId: body.userId,
        userName: 'admin',
        guildId: guild.id,
        what: body.what,
        schedule: toSchedule(body.schedule),
        scheduleDescription: body.scheduleDescription,
        channelId: body.channelId,
        targetUserIds: body.targetUserIds,
        actionType: body.actionType,
        source: 'admin',
      }),
    )
    return toReminderView(row, this.resolver())
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateReminderBodySchema))
    body: UpdateReminderBody,
  ): Promise<ReminderView> {
    const { schedule, ...rest } = body
    const row = await mapErrors(() =>
      this.reminders.update(id, {
        ...rest,
        ...(schedule && { schedule: toSchedule(schedule) }),
      }),
    )
    return toReminderView(row, this.resolver())
  }

  @Delete(':id')
  async cancel(@Param('id') id: string): Promise<ReminderView> {
    const row = await mapErrors(() => this.reminders.cancel(id))
    return toReminderView(row, this.resolver())
  }

  private guild(): Guild {
    const guild = this.client.guilds.cache.first()
    if (!guild) throw new ServiceUnavailableException('Discord is not ready')
    return guild
  }

  private resolver(): ReminderResolver {
    const members = this.client.guilds.cache.first()?.members.cache
    return {
      userName: id =>
        members?.get(id)?.displayName ??
        this.client.users.cache.get(id)?.displayName ??
        null,
      channelName: id => {
        const channel = this.client.channels.cache.get(id)
        return channel && 'name' in channel && channel.name
          ? channel.name
          : null
      },
    }
  }
}
