import type { ContentBlock } from '@agentclientprotocol/sdk'
import { createTwoFilesPatch } from 'diff'

import type { DiffContent, ImageAttachment } from './agent.types'

export function buildPromptBlocks(
  text: string,
  images: ImageAttachment[],
): ContentBlock[] {
  const blocks: ContentBlock[] = []
  if (text) blocks.push({ type: 'text', text })
  for (const img of images) {
    blocks.push({ type: 'image', data: img.data, mimeType: img.mimeType })
  }
  return blocks
}

const DISCORD_MAX_LENGTH = 2000
const MAX_DIFF_LINES = 150

const CLOSE_FENCE = '\n```'

export function splitMessage(
  text: string,
  maxLength = DISCORD_MAX_LENGTH,
): string[] {
  if (text.length <= maxLength) return [text]

  const budget = maxLength - CLOSE_FENCE.length

  const chunks: string[] = []
  let remaining = text
  let inCodeBlock = false
  let codeFence = ''

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }

    let splitAt = budget
    const lastNewline = remaining.lastIndexOf('\n', budget)
    if (lastNewline > budget * 0.5) {
      splitAt = lastNewline + 1
    }

    let chunk = remaining.slice(0, splitAt)
    remaining = remaining.slice(splitAt)

    const fenceMatches = chunk.match(/```\w*/g) || []
    for (const fence of fenceMatches) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeFence = fence
      } else {
        inCodeBlock = false
        codeFence = ''
      }
    }

    if (inCodeBlock) {
      chunk += CLOSE_FENCE
      remaining = codeFence + '\n' + remaining
      inCodeBlock = false
      codeFence = ''
    }

    chunks.push(chunk)
  }

  return chunks
}

export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

const STATUS_ICONS: Record<ToolStatus, string> = {
  pending: '⏳',
  in_progress: '🔄',
  completed: '✅',
  failed: '❌',
}

export function formatToolSummary(
  tools: Map<
    string,
    { title: string; status: ToolStatus; rawInput?: Record<string, unknown> }
  >,
): string {
  const lines: string[] = []
  for (const [, tool] of tools) {
    const description = extractDescription(tool.rawInput)
    if (description) {
      lines.push(`${STATUS_ICONS[tool.status]} ${description}`)
      continue
    }

    const rawDetail = pickSafeFieldValue(tool.rawInput)
    const detail = rawDetail
      ? truncate(sanitizeDetail(rawDetail), MAX_DETAIL_LENGTH)
      : extractDetailFromTitle(tool.title)

    // Bash-style tool calls set the title to the raw command itself, which is
    // exactly what rawDetail also resolves to — showing both duplicates the
    // same (potentially very long) string. Collapse to the single, truncated,
    // code-formatted copy instead.
    if (rawDetail !== null && rawDetail === tool.title) {
      lines.push(`${STATUS_ICONS[tool.status]} \`${detail}\``)
      continue
    }

    const suffix = detail ? ` · \`${detail}\`` : ''
    const title = truncate(sanitizeDetail(tool.title), MAX_DETAIL_LENGTH)
    lines.push(`${STATUS_ICONS[tool.status]} ${title}${suffix}`)
  }
  return lines.join('\n')
}

const MAX_DETAIL_LENGTH = 80

const SAFE_FIELDS = ['command', 'file_path', 'pattern', 'query', 'path', 'url']

const BLOCKED_SUBSTRINGS = [
  'token',
  'secret',
  'password',
  'key',
  'content',
  'new_string',
  'old_string',
  'credential',
  'auth',
]

function isBlockedField(name: string): boolean {
  const lower = name.toLowerCase()
  return BLOCKED_SUBSTRINGS.some(sub => lower.includes(sub))
}

function extractDescription(rawInput?: Record<string, unknown>): string | null {
  if (!rawInput) return null
  const value = rawInput.description
  if (typeof value === 'string' && value.trim()) {
    return truncate(sanitizeDetail(value), MAX_DETAIL_LENGTH)
  }
  return null
}

function pickSafeFieldValue(rawInput?: Record<string, unknown>): string | null {
  if (!rawInput) return null

  for (const field of SAFE_FIELDS) {
    if (typeof rawInput[field] === 'string' && rawInput[field]) {
      return rawInput[field] as string
    }
  }

  for (const [fieldName, value] of Object.entries(rawInput)) {
    if (isBlockedField(fieldName)) continue
    if (SAFE_FIELDS.includes(fieldName)) continue
    if (typeof value === 'string' && value.length > 0 && value.length < 100) {
      return value
    }
  }

  return null
}

function extractDetailFromTitle(title: string): string | null {
  if (!title) return null

  const colonMatch = title.match(/^[^:]+:\s*(.+)/)
  if (colonMatch) {
    return truncate(sanitizeDetail(colonMatch[1].trim()), MAX_DETAIL_LENGTH)
  }

  const spaceIdx = title.indexOf(' ')
  if (spaceIdx > 0 && spaceIdx < title.length - 1) {
    const rest = title.slice(spaceIdx + 1).trim()
    if (
      rest.startsWith('/') ||
      rest.startsWith('./') ||
      rest.startsWith('http') ||
      rest.includes('.')
    ) {
      return truncate(sanitizeDetail(rest), MAX_DETAIL_LENGTH)
    }
  }

  return null
}

function sanitizeDetail(text: string): string {
  return text.replace(/`/g, "'")
}

function truncate(text: string, max: number): string {
  const firstLine = text.split('\n')[0]
  if (firstLine.length <= max) return firstLine
  return firstLine.slice(0, max - 1) + '…'
}

export function formatDiff(
  diffs: DiffContent[],
  maxLines = MAX_DIFF_LINES,
): string[] {
  if (diffs.length === 0) return []

  const parts: string[] = []

  for (const d of diffs) {
    const fileName = d.path.split('/').pop() ?? d.path
    const oldText = d.oldText ?? ''
    const patch = createTwoFilesPatch(
      d.oldText == null ? '/dev/null' : d.path,
      d.path,
      oldText,
      d.newText,
      undefined,
      undefined,
      { context: 3 },
    )

    const patchLines = patch.split('\n')
    const startIdx = patchLines.findIndex(l => l.startsWith('---'))
    const diffLines = startIdx >= 0 ? patchLines.slice(startIdx) : patchLines

    let truncated = false
    let displayLines = diffLines
    if (diffLines.length > maxLines) {
      displayLines = diffLines.slice(0, maxLines)
      truncated = true
    }

    let block = `**${fileName}**\n\`\`\`diff\n${displayLines.join('\n')}\n\`\`\``
    if (truncated) {
      block += `\n*... ${diffLines.length - maxLines} more lines*`
    }

    parts.push(block)
  }

  const fullMessage = parts.join('\n\n')
  return splitMessage(fullMessage)
}
