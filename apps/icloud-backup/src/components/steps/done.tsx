import { Button, Card, ConfirmDialog, Note, Panel, PanelHead } from '@lilnas/ui'
import { type JSX, type ReactNode, useState } from 'react'

import { StateHead } from 'src/components/steps/state-head'
import { PHONE_FULL } from 'src/components/steps/styles'
import { SyncNow } from 'src/components/steps/sync-now'
import type { StepProps } from 'src/components/steps/types'
import { useAction } from 'src/components/steps/use-action'
import { formatBytes, formatCount, formatRelative } from 'src/lib/format'
import type { BackupActions } from 'src/lib/use-backup'

type Immich = NonNullable<NonNullable<StepProps['view']['account']>['immich']>

function Fact({
  label,
  children,
}: {
  label: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-label text-ink-3 uppercase">{label}</dt>
      <dd className="text-h3 tabular-nums">{children}</dd>
    </div>
  )
}

/**
 * The Immich sign-in block. A temporary password lives only in this
 * component's state: it is shown once and gone on reload.
 */
function ImmichSignIn({
  immich,
  actions,
}: {
  immich: Immich
  actions: BackupActions
}): JSX.Element {
  const [password, setPassword] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const create = useAction()

  const createPassword = async (): Promise<void> => {
    let next: string | null = null
    const ok = await create.run(async () => {
      next = await actions.resetImmichPassword()
    })
    setConfirming(false)
    if (ok && next !== null) {
      setPassword(next)
      setCopied(false)
      setCopyFailed(false)
    }
  }

  const copy = async (): Promise<void> => {
    if (password === null) return
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      setCopyFailed(false)
    } catch {
      setCopied(false)
      setCopyFailed(true)
    }
  }

  return (
    <Panel>
      <PanelHead title="Your Immich sign-in" />
      <div className="p-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-label text-ink-3 uppercase">Email</span>
          <span className="font-mono text-mono break-all">{immich.email}</span>
        </div>

        {immich.createdByUs ? (
          <>
            {password === null ? (
              <p className="mt-3 text-sm text-ink-3">
                You haven&apos;t set a password for Immich yet. Make a temporary
                one, then change it when you sign in.
              </p>
            ) : (
              <>
                <p className="mt-3 text-sm text-ink-3">
                  Use this password the first time you sign in to Immich.
                </p>
                <Card
                  className="mt-2 flex items-center justify-between gap-3 px-3 py-2.5"
                  variant="sunk"
                >
                  <code
                    aria-label="Temporary password"
                    className="min-w-0 font-mono text-mono break-all text-ink"
                  >
                    {password}
                  </code>
                  <Button size="sm" onClick={() => void copy()}>
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </Card>
                <p className="mt-2 text-cap text-warn">
                  Shown once. Immich will ask you to change it.
                </p>
                {copyFailed ? (
                  <p className="mt-1 text-cap text-bad">
                    Couldn&apos;t copy it. Select it and copy it by hand.
                  </p>
                ) : null}
              </>
            )}

            <Button
              className={`mt-3 ${PHONE_FULL}`}
              icon="key"
              loading={create.pending && !confirming}
              variant={password === null ? 'outline' : 'ghost'}
              onClick={() =>
                password === null ? void createPassword() : setConfirming(true)
              }
            >
              {password === null
                ? 'Create a temporary password'
                : 'Create a new password'}
            </Button>

            {create.error ? (
              <Note
                className="mt-3"
                lead="Couldn't create a password."
                tone="bad"
              >
                {create.error}
              </Note>
            ) : null}

            <ConfirmDialog
              body="The password shown now stops working. Immich will ask you to change the new one when you sign in."
              cancelLabel="Keep it"
              confirmLabel="Replace it"
              open={confirming}
              pending={create.pending}
              title="Replace the temporary password?"
              tone="accent"
              onConfirm={() => void createPassword()}
              onOpenChange={setConfirming}
            />
          </>
        ) : (
          <p className="mt-3 text-sm text-ink-3">
            You already had an Immich account, so we linked your photos to it.
            Sign in with your existing Immich account and the password you
            already use.
          </p>
        )}
      </div>
    </Panel>
  )
}

/** The backup is current: facts, Sync now, and the way into Immich. */
export function Done({ view, actions }: StepProps): JSX.Element {
  const account = view.account
  const immich = account?.immich ?? null
  const lastBackupAt = account?.lastBackupAt ?? null

  return (
    <section data-step="done">
      <StateHead
        badge={{ tone: 'ok', label: 'Up to date' }}
        title="Your photos are backed up"
      />

      <Panel className="mt-5 p-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Fact label="Last backup">
            {lastBackupAt ? (
              <time
                dateTime={lastBackupAt}
                title={new Date(lastBackupAt).toLocaleString()}
              >
                {formatRelative(lastBackupAt)}
              </time>
            ) : (
              '—'
            )}
          </Fact>
          <Fact label="Photos and videos">
            {formatCount(account?.totalItems ?? 0)}
          </Fact>
          <Fact label="Size">{formatBytes(account?.totalBytes ?? 0)}</Fact>
        </dl>
        <SyncNow
          actions={actions}
          className="mt-4"
          lowDiskSpace={view.lowDiskSpace}
        />
      </Panel>

      {immich ? (
        <>
          <Button
            className={`mt-4 ${PHONE_FULL}`}
            iconEnd="external"
            render={<a href={immich.url} rel="noreferrer" target="_blank" />}
            variant="accent"
          >
            Open my photos
          </Button>
          <div className="mt-4">
            <ImmichSignIn actions={actions} immich={immich} />
          </div>
        </>
      ) : (
        <Note
          className="mt-4"
          lead="Your photos are safe on the server."
          tone="warn"
        >
          We couldn&apos;t finish setting up Immich this time. Sync now will try
          again.
        </Note>
      )}
    </section>
  )
}
