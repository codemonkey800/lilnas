import { z } from 'zod'

// Query params on `GET /theater/playback/:id` (ORCHESTRATE.md § "Backend
// endpoints"). Express hands query values to us as strings (or omits the key
// entirely when the frontend doesn't send it), so every field coerces a
// numeric string to a number and stays optional — all four params are
// optional per the contract.
export const PlaybackQuerySchema = z.object({
  maxBitrate: z.coerce.number().int().positive().optional(),
  audioIndex: z.coerce.number().int().nonnegative().optional(),
  subtitleIndex: z.coerce.number().int().nonnegative().optional(),
  startTicks: z.coerce.number().int().nonnegative().optional(),
})

export type PlaybackQuery = z.infer<typeof PlaybackQuerySchema>

// Query params on `GET /theater/items/:id/episodes` — `seasonId` is required
// since the iPad always drills season-first (pick a season, then see that
// season's episodes), never "all episodes across every season" in one call.
export const EpisodesQuerySchema = z.object({
  seasonId: z.string().min(1),
})

export type EpisodesQuery = z.infer<typeof EpisodesQuerySchema>
