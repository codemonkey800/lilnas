import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { Observable, Subject } from 'rxjs'

import { DrizzleService } from 'src/db/drizzle.service'
import { botSettings } from 'src/db/schema'
import { DEFAULT_MODELS } from 'src/llm/models/catalog'
import { ModelRegistry } from 'src/llm/models/model-registry'
import { MODEL_ROLES } from 'src/llm/models/roles'
import {
  Settings,
  SettingsPatch,
  SettingsPatchSchema,
  SettingsSchema,
} from 'src/llm/settings/settings.schema'
import { KAWAII_PROMPT } from 'src/utils/prompts'

const SETTINGS_ROW_ID = 'default'

export interface SettingsIssue {
  path: string
  message: string
}

export class SettingsValidationError extends Error {
  constructor(readonly issues: SettingsIssue[]) {
    super(
      `Invalid settings: ${issues.map(i => `${i.path}: ${i.message}`).join('; ')}`,
    )
    this.name = 'SettingsValidationError'
  }
}

export function defaultSettings(): Settings {
  return {
    models: { ...DEFAULT_MODELS },
    temperature: 0,
    reasoningEffort: 'medium',
    systemPrompt: KAWAII_PROMPT,
  }
}

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name)
  private readonly subject = new Subject<Settings>()
  private current: Settings = defaultSettings()
  private updatedAt = new Date()

  readonly changes$: Observable<Settings> = this.subject.asObservable()

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly registry: ModelRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    const rows = await this.drizzle.db
      .select()
      .from(botSettings)
      .where(eq(botSettings.id, SETTINGS_ROW_ID))
      .limit(1)
    const row = rows[0]
    if (!row) {
      this.updatedAt = await this.persist(this.current, false)
      this.logger.log({}, 'Seeded default bot settings')
      return
    }

    const defaults = defaultSettings()
    const parsed = SettingsSchema.safeParse({
      models: { ...defaults.models, ...(row.models ?? {}) },
      temperature: row.temperature ?? defaults.temperature,
      reasoningEffort: row.reasoningEffort ?? defaults.reasoningEffort,
      systemPrompt: row.systemPrompt ?? defaults.systemPrompt,
    })
    this.updatedAt = row.updatedAt
    if (parsed.success) {
      this.current = parsed.data
    } else {
      this.logger.warn(
        { issues: parsed.error.issues },
        'Stored bot settings invalid, using defaults',
      )
    }
  }

  get(): Settings {
    return this.current
  }

  getUpdatedAt(): Date {
    return this.updatedAt
  }

  async update(patch: SettingsPatch): Promise<Settings> {
    const parsedPatch = SettingsPatchSchema.safeParse(patch)
    if (!parsedPatch.success) {
      throw new SettingsValidationError(
        parsedPatch.error.issues.map(i => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      )
    }
    const { models, ...rest } = parsedPatch.data
    const merged = SettingsSchema.safeParse({
      ...this.current,
      ...stripUndefined(rest),
      models: { ...this.current.models, ...stripUndefined(models ?? {}) },
    })
    if (!merged.success) {
      throw new SettingsValidationError(
        merged.error.issues.map(i => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      )
    }

    const issues: SettingsIssue[] = []
    for (const role of MODEL_ROLES) {
      const id = merged.data.models[role]
      if (!this.registry.has(id)) {
        issues.push({ path: `models.${role}`, message: `Unknown model: ${id}` })
      } else if (!this.registry.isAllowedFor(id, role)) {
        issues.push({
          path: `models.${role}`,
          message: `Model ${id} cannot be used for role ${role}`,
        })
      }
    }
    if (issues.length) throw new SettingsValidationError(issues)

    return this.apply(merged.data)
  }

  reset(): Promise<Settings> {
    return this.apply(defaultSettings())
  }

  private async apply(next: Settings): Promise<Settings> {
    this.updatedAt = await this.persist(next, true)
    this.current = next
    this.subject.next(next)
    return next
  }

  private async persist(settings: Settings, exists: boolean): Promise<Date> {
    const values = {
      models: settings.models,
      temperature: settings.temperature,
      reasoningEffort: settings.reasoningEffort,
      systemPrompt: settings.systemPrompt,
      updatedAt: new Date(),
    }
    if (exists) {
      await this.drizzle.db
        .update(botSettings)
        .set(values)
        .where(eq(botSettings.id, SETTINGS_ROW_ID))
    } else {
      await this.drizzle.db
        .insert(botSettings)
        .values({ id: SETTINGS_ROW_ID, ...values })
    }
    return values.updatedAt
  }
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>
}
