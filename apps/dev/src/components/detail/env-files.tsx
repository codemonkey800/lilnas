import type { JSX } from 'react'

import { Panel, PanelHead } from 'src/components/detail/panel'
import { Chip } from 'src/components/ui/chip'
import { Icon } from 'src/components/ui/icon'
import { Kbd } from 'src/components/ui/kbd'
import { shortPath } from 'src/lib/stack-display'
import type { EnvFileRef } from 'src/registry/registry.types'

/** The env files the compose file names, and whether this host has them. */
export function EnvFilesPanel({
  envFiles,
}: {
  envFiles: EnvFileRef[]
}): JSX.Element {
  return (
    <Panel aria-label="Env files">
      <PanelHead caption="read from the compose file" title="Env files" />
      {envFiles.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-3">
          The compose file names no env files.
        </p>
      ) : (
        <ul>
          {envFiles.map(file => (
            <li
              className="flex items-center gap-3 px-5 py-3 [&+&]:border-t [&+&]:border-line-soft"
              key={file.path}
            >
              <Icon
                className="h-[15px] w-[15px] shrink-0 text-ink-4"
                name="file"
              />
              <span
                className="min-w-0 flex-1 truncate font-mono text-mono text-ink"
                title={file.path}
              >
                {shortPath(file.path)}
              </span>
              <span className="font-mono text-mono-sm text-ink-4">
                {file.required ? 'required' : 'optional'}
              </span>
              {file.exists ? (
                <Chip icon="check" label="present" tone="ok" />
              ) : (
                <Chip
                  icon="x"
                  label="missing"
                  tone={file.required ? 'bad' : 'mute'}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-line-soft px-5 py-3 text-sm text-ink-3">
        Missing a required file? Run
        <Kbd className="mx-1">pnpm lilnas secrets decrypt</Kbd>
        on the host, then press Up.
      </p>
    </Panel>
  )
}
