import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'

import {
  type DownloadEventPayload,
  INTERNAL_DOWNLOAD_EVENT,
  type TrackedDownload,
} from './downloads.types'

export type PendingCancelEntry = {
  tvdbId: number
  seriesId: number
  cancelledAt: number
}

export type TrackedDownloadPatch = Partial<
  Pick<
    TrackedDownload,
    | 'queueId'
    | 'commandId'
    | 'lastProgress'
    | 'lastStatus'
    | 'lastSizeleft'
    | 'lastTitle'
    | 'lastSize'
    | 'lastEta'
    | 'commandTerminalAt'
    | 'initiatedAt'
  >
>

/**
 * Owns the in-memory download state (tracked downloads and pending cancels).
 * All state mutations go through this service to keep a single source of truth.
 */
@Injectable()
export class DownloadStateService {
  /** Keys: "movie:{tmdbId}" | "episode:{sonarrEpisodeId}" */
  private readonly tracked = new Map<string, TrackedDownload>()
  private readonly pendingCancelEpisodes = new Map<number, PendingCancelEntry>()

  constructor(private readonly events: EventEmitter2) {}

  getTracked(): ReadonlyMap<string, TrackedDownload> {
    return this.tracked
  }

  getPendingCancelEpisodes(): ReadonlyMap<number, PendingCancelEntry> {
    return this.pendingCancelEpisodes
  }

  setTracked(key: string, entry: TrackedDownload): void {
    this.tracked.set(key, entry)
  }

  updateTracked(key: string, patch: TrackedDownloadPatch): void {
    const existing = this.tracked.get(key)
    if (existing) {
      this.tracked.set(key, { ...existing, ...patch })
    }
  }

  removeTracked(key: string): void {
    this.tracked.delete(key)
  }

  setPendingCancel(episodeId: number, entry: PendingCancelEntry): void {
    this.pendingCancelEpisodes.set(episodeId, entry)
  }

  removePendingCancel(episodeId: number): void {
    this.pendingCancelEpisodes.delete(episodeId)
  }

  emitEvent(payload: DownloadEventPayload): void {
    this.events.emit(INTERNAL_DOWNLOAD_EVENT, {
      eventName: payload.event,
      payload,
    })
  }
}
