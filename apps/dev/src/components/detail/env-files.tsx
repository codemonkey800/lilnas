import { Badge, Card, Icon, Kbd } from '@lilnas/ui'
import type { JSX } from 'react'

import { CardHead } from 'src/components/detail/card-head'
import { shortPath } from 'src/lib/stack-display'
import type { EnvFileRef } from 'src/registry/registry.types'

/** The env files the compose file names, and whether this host has them. */
export function EnvFilesPanel({
  envFiles,
}: {
  envFiles: EnvFileRef[]
}): JSX.Element {
  return (
    <Card aria-label="Env files" role="region">
      <CardHead caption="read from the compose file" title="Env files" />
      {envFiles.length === 0 ? (
        <p className="text-sm text-ink-3">
          The compose file names no env files.
        </p>
      ) : (
        <ul>
          {envFiles.map(file => (
            <li
              className="flex items-center gap-3 border-t border-line-soft py-2 first:border-t-0 first:pt-0"
              key={file.path}
            >
              <Icon className="text-ink-3" name="file" size={14} />
              <span
                className="min-w-0 flex-1 truncate font-mono text-mono text-ink"
                title={file.path}
              >
                {shortPath(file.path)}
              </span>
              <span className="text-cap text-ink-3">
                {file.required ? 'required' : 'optional'}
              </span>
              {file.exists ? (
                <Badge tone="ok">
                  <Icon name="check" size={12} />
                  Present
                </Badge>
              ) : (
                <Badge tone={file.required ? 'bad' : 'mute'}>
                  <Icon name="x" size={12} />
                  Missing
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 border-t border-line-soft pt-3 text-sm text-ink-3">
        Missing a required file? Run <Kbd>pnpm lilnas secrets decrypt</Kbd> on
        the host, then press Up.
      </p>
    </Card>
  )
}
