import * as fs from 'node:fs'
import * as path from 'node:path'

import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

import { TokenService } from 'src/token/token.service'

export interface AppEntry {
  slug: string
  packageName: string
}

export interface AppDetails extends AppEntry {
  tokenCount: number
}

@Injectable()
export class AppsService implements OnModuleInit {
  private readonly logger = new Logger(AppsService.name)
  private apps: AppEntry[] = []

  constructor(private readonly tokenService: TokenService) {}

  onModuleInit() {
    const manifestPath = path.join(__dirname, '../generated/apps.json')

    if (!fs.existsSync(manifestPath)) {
      this.logger.warn(
        `Apps manifest not found at ${manifestPath}. Run 'pnpm prebuild' to generate it.`,
      )
      return
    }

    const raw = fs.readFileSync(manifestPath, 'utf-8')
    this.apps = JSON.parse(raw) as AppEntry[]
    this.logger.log(`Loaded ${this.apps.length} apps from manifest`)
  }

  getApps(): AppEntry[] {
    return this.apps
  }

  getApp(slug: string): AppEntry | undefined {
    return this.apps.find(a => a.slug === slug)
  }

  async getAppsWithDetails(): Promise<AppDetails[]> {
    const counts = await this.tokenService.getTokenCountsByApp()

    return this.apps.map(app => ({
      ...app,
      tokenCount: counts[app.slug] ?? 0,
    }))
  }
}
