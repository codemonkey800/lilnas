// Safe error-reason extraction for a persisted event's context — never the
// raw error message, which could carry transcript/prompt content. Shared by
// session-manager.service.ts and composite-acp-handler.ts's
// handleWriterError so the scrub convention has a single source of truth.
export function errorCode(err: unknown): string {
  return err instanceof Error
    ? ((err as NodeJS.ErrnoException).code ?? err.name)
    : 'UNKNOWN'
}
