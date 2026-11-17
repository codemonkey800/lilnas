'use client'

import type { Column } from '@lilnas/ui'
import {
  Button,
  ConfirmDialog,
  DataList,
  EmptyState,
  Input,
  Note,
  Panel,
  Radio,
  RadioGroup,
} from '@lilnas/ui'
import type { TransitionStartFunction } from 'react'
import { useMemo, useState } from 'react'

import { linkDiscordAccount, unlinkDiscordAccount } from 'src/app/admin/actions'
import { DiscordBadge } from 'src/app/admin/people-list'
import type {
  AdminDiscordLinkEntry,
  AdminDiscordUnlinked,
  AdminDiscordUnlinkedAccount,
  AdminDiscordUnlinkedPerson,
} from 'src/app/admin/require-admin'
import { SectionHead } from 'src/app/admin/section-head'
import { timeAgo } from 'src/app/lib/time-ago'

// ──────────────────────────────────────────────────────────────────────────────
// D3 (plan 017): the admin dashboard's Discord-links panel.
//
// THE central design constraint, and the reason this panel looks the way it
// does: there is NO text input anywhere in here for a snowflake or a
// username. A handle is never admin-typed. Both sides of a link are PICKED
// from lists of things this system has actually observed — the people who
// have signed in, and the Discord accounts that have actually run a Discord
// command. Typing a handle would mean the admin could invent one, and a
// mistyped-but-well-formed snowflake links a stranger's Discord account to a
// real person's lilnas identity with no error anywhere. Picking cannot
// produce a value that was never observed, which is why the backend also
// refuses to link a never-seen account (see actions.ts's linkDiscordAccount
// comment for that 404) — this UI and that check defend the same property
// from both ends.
//
// The two filter inputs below are the ONLY inputs in the panel, and they
// only ever narrow an already-observed list; neither can contribute a value
// to the link call.
//
// Mutations follow the same shape as the two dialogs (add-person-modal.tsx,
// edit-access-modal.tsx): the parent hands down `isPending`/
// `startTransition`/`showToast`, and this component wraps its own calls in
// runPanelAction() below so a backend failure lands in THIS panel's own
// `Note` rather than the dashboard's page-level one — the
// message ("Discord account already linked to someone@example.com") is
// about the pair the admin just picked, and belongs next to the picker.
// Refreshing the lists afterwards is NOT this component's job: every
// mutation publishes to the admin broadcast topic, and the dashboard's own
// SSE subscription turns that into router.refresh() and fresh props (see
// admin-dashboard-client.tsx's header comment).
// ──────────────────────────────────────────────────────────────────────────────

// Below this many rows, a filter box costs more than it buys: the whole list
// is already on screen at once, and the input is one more piece of chrome
// between the admin and the two rows they're trying to pair. At or above it,
// scanning starts to lose to typing. Deliberately ONE constant shared by
// both lists rather than two independently-tuned numbers — the two lists sit
// side by side, and a filter appearing over one but not the other purely
// because they crossed different thresholds reads as a bug.
const FILTER_MIN_ROWS = 8

// A whole choice row is the tap target; the selected one takes the accent.
const CHOICE_ROW =
  'w-full rounded-md border border-line px-3 py-2 hover:border-line-loud has-data-checked:border-accent-dim has-data-checked:bg-accent-ghost'

function matchesFilter(haystacks: (string | null)[], term: string): boolean {
  if (term === '') return true
  return haystacks.some(value => value?.toLowerCase().includes(term))
}

export type DiscordLinksPanelProps = {
  unlinked: AdminDiscordUnlinked
  links: AdminDiscordLinkEntry[]
  isPending: boolean
  startTransition: TransitionStartFunction
  showToast: (message: string) => void
}

export function DiscordLinksPanel({
  unlinked,
  links,
  isPending,
  startTransition,
  showToast,
}: DiscordLinksPanelProps) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [selectedDiscordUserId, setSelectedDiscordUserId] = useState<
    string | null
  >(null)
  const [peopleFilter, setPeopleFilter] = useState('')
  const [accountsFilter, setAccountsFilter] = useState('')
  const [panelError, setPanelError] = useState<string | null>(null)
  // The link an Unlink confirm is about. Kept after the dialog closes so its
  // title doesn't change while it fades out.
  const [unlinkTarget, setUnlinkTarget] =
    useState<AdminDiscordLinkEntry | null>(null)
  const [isUnlinkOpen, setIsUnlinkOpen] = useState(false)

  const { people, accounts } = unlinked

  // Both lists arrive in an order the SERVER chose on purpose and neither is
  // re-sorted here: `people` is email-ascending, `accounts` is lastSeenAt
  // DESCENDING (the admin has usually just watched the account they want run
  // a Discord command, so it is the first row), and `links` below is
  // email-ascending. Filtering preserves whatever order it was handed, so
  // typing never reshuffles the list under the admin's cursor.
  const visiblePeople = useMemo(() => {
    const term = peopleFilter.trim().toLowerCase()
    return people.filter(person =>
      matchesFilter([person.name, person.email], term),
    )
  }, [people, peopleFilter])

  const visibleAccounts = useMemo(() => {
    const term = accountsFilter.trim().toLowerCase()
    return accounts.filter(account =>
      matchesFilter([account.username, account.displayName], term),
    )
  }, [accounts, accountsFilter])

  // Resolved against the FULL lists, not the filtered ones: a selection the
  // admin made and then hid behind a filter is still a real selection, and
  // the Link button names both sides explicitly, so there is no ambiguity
  // about what it will do. Resolving against the filtered list instead would
  // silently disarm the button the moment the admin typed. `null` here means
  // the row genuinely went away (a refresh landed while they were choosing —
  // someone else linked that account), which correctly disables the button.
  const selectedPerson: AdminDiscordUnlinkedPerson | null =
    people.find(person => person.userId === selectedUserId) ?? null
  const selectedAccount: AdminDiscordUnlinkedAccount | null =
    accounts.find(account => account.discordUserId === selectedDiscordUserId) ??
    null

  function runPanelAction(work: () => Promise<void>) {
    setPanelError(null)
    startTransition(async () => {
      try {
        await work()
      } catch (err) {
        // The backend writes these sentences for a human to read
        // ("Discord account already linked to someone@example.com") and
        // callBackend() appends them verbatim to the thrown Error, so the
        // whole message is rendered as-is — the same thing every other
        // client component in this app does with `err.message`.
        setPanelError(err instanceof Error ? err.message : 'Action failed')
      }
    })
  }

  function handleLink() {
    if (!selectedPerson || !selectedAccount) return
    const { userId, email } = selectedPerson
    const { discordUserId, username } = selectedAccount
    runPanelAction(async () => {
      await linkDiscordAccount(userId, discordUserId)
      showToast(`Linked ${email} ↔ @${username}`)
      // Cleared only on SUCCESS — a failed link leaves both picks in place
      // so the admin can read the error and act on the same pair (unlink
      // the other side, pick a different row) without re-choosing from
      // scratch.
      setSelectedUserId(null)
      setSelectedDiscordUserId(null)
    })
  }

  // Confirmed like every other destructive action on this dashboard (Block,
  // Remove access, Sign out everywhere). A 404 from this call is a GENUINE
  // error, deliberately not swallowed into a success — see actions.ts's
  // unlinkDiscordAccount() comment: reaching it means this view is stale, and
  // surfacing the message is what prompts the refresh that makes the screen
  // honest again.
  function handleUnlinkClick(entry: AdminDiscordLinkEntry) {
    setUnlinkTarget(entry)
    setIsUnlinkOpen(true)
  }

  function handleUnlinkConfirm() {
    if (!unlinkTarget) return
    const { userId, username } = unlinkTarget
    setIsUnlinkOpen(false)
    runPanelAction(async () => {
      await unlinkDiscordAccount(userId)
      showToast(`Unlinked @${username}`)
    })
  }

  const linkColumns: Column<AdminDiscordLinkEntry>[] = [
    {
      key: 'person',
      header: 'Person',
      primary: true,
      render: entry => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{entry.name}</span>
          <span className="truncate font-mono text-mono-sm text-ink-3">
            {entry.email}
          </span>
        </span>
      ),
    },
    {
      key: 'discord',
      header: 'Discord',
      render: entry => <DiscordBadge handle={entry.username} />,
    },
    {
      key: 'linked',
      header: 'Linked',
      // Same hydration caveat as the last-seen line below —
      // toLocaleDateString() resolves against the renderer's own locale and
      // timezone, which the server and the browser need not share.
      render: entry => (
        <span className="text-cap text-ink-3" suppressHydrationWarning>
          {new Date(entry.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: entry => (
        <div className="flex md:justify-end">
          <Button
            disabled={isPending}
            size="sm"
            variant="bad"
            onClick={() => handleUnlinkClick(entry)}
          >
            Unlink
          </Button>
        </div>
      ),
    },
  ]

  return (
    <section className="flex flex-col gap-3">
      <SectionHead title="Discord links" count={links.length} />

      <p className="max-w-[74ch] text-sm text-ink-3">
        Pair a person with a Discord account so their downloads are attributed
        to them. Both sides are picked from what this system has already seen —
        nothing here is typed by hand.
      </p>

      {panelError ? (
        <Note
          tone="bad"
          lead="Couldn’t link."
          onDismiss={() => setPanelError(null)}
        >
          {panelError}
        </Note>
      ) : null}

      {/* Side by side on a normal screen, stacked on a narrow one — the two
          lists are read together (pick a row on the left, pick its partner
          on the right), so they stay adjacent wherever there is room. */}
      <div className="grid gap-5 rounded-lg border border-line bg-surface p-4 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <p
            className="text-sm font-medium text-ink-2"
            id="discord-people-label"
          >
            People without a Discord link
          </p>
          {people.length >= FILTER_MIN_ROWS ? (
            <Input
              aria-label="Filter people without a Discord link"
              placeholder="Filter people…"
              value={peopleFilter}
              onChange={event => setPeopleFilter(event.target.value)}
            />
          ) : null}
          {people.length === 0 ? (
            <div className="rounded-md border border-dashed border-line px-4 py-8 text-center">
              <p className="text-sm font-medium">Everyone is linked</p>
              <p className="mt-1 text-cap text-ink-3">
                People who sign in without a link show up here.
              </p>
            </div>
          ) : (
            <RadioGroup
              aria-labelledby="discord-people-label"
              className="max-h-[280px] gap-1.5 overflow-y-auto pr-0.5"
              disabled={isPending}
              value={selectedUserId ?? ''}
              onValueChange={value => setSelectedUserId(value)}
            >
              {visiblePeople.map(person => (
                <Radio
                  key={person.userId}
                  className={CHOICE_ROW}
                  value={person.userId}
                  label={
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-ink">
                        {person.name}
                      </span>
                      <span className="truncate font-mono text-mono-sm text-ink-3">
                        {person.email}
                      </span>
                    </span>
                  }
                />
              ))}
            </RadioGroup>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <p
            className="text-sm font-medium text-ink-2"
            id="discord-accounts-label"
          >
            Discord accounts without a lilnas link
          </p>
          {accounts.length >= FILTER_MIN_ROWS ? (
            <Input
              aria-label="Filter Discord accounts without a lilnas link"
              placeholder="Filter accounts…"
              value={accountsFilter}
              onChange={event => setAccountsFilter(event.target.value)}
            />
          ) : null}
          {accounts.length === 0 ? (
            // Day one, this is what the panel looks like, and it is NOT an
            // error: the roster is populated by observation, so it stays
            // empty until somebody actually uses the bot. The copy says so
            // plainly rather than leaving an admin wondering what they
            // misconfigured.
            <div className="rounded-md border border-dashed border-line px-4 py-8 text-center">
              <p className="text-sm font-medium">No Discord accounts yet</p>
              <p className="mt-1 text-cap text-ink-3">
                They appear the first time someone runs{' '}
                <code className="font-mono text-mono-sm">/download</code>.
              </p>
            </div>
          ) : (
            <RadioGroup
              aria-labelledby="discord-accounts-label"
              className="max-h-[280px] gap-1.5 overflow-y-auto pr-0.5"
              disabled={isPending}
              value={selectedDiscordUserId ?? ''}
              onValueChange={value => setSelectedDiscordUserId(value)}
            >
              {visibleAccounts.map(account => (
                <Radio
                  key={account.discordUserId}
                  className={CHOICE_ROW}
                  value={account.discordUserId}
                  label={
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-mono text-mono-sm font-medium text-ink">
                        @{account.username}
                      </span>
                      {/* suppressHydrationWarning for the same reason the
                          dashboard's request cards use it: timeAgo() reads
                          Date.now(), so the server's string and the client's
                          first render legitimately differ. */}
                      <span
                        className="truncate text-cap text-ink-3"
                        suppressHydrationWarning
                      >
                        {account.displayName ? `${account.displayName} · ` : ''}
                        last seen {timeAgo(account.lastSeenAt)}
                      </span>
                    </span>
                  }
                />
              ))}
            </RadioGroup>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          disabled={!selectedPerson || !selectedAccount || isPending}
          variant="accent"
          className="max-md:w-full"
          onClick={handleLink}
        >
          {selectedPerson && selectedAccount
            ? `Link ${selectedPerson.email} ↔ @${selectedAccount.username}`
            : 'Link'}
        </Button>
      </div>

      <Panel>
        <DataList
          caption="Discord links"
          columns={linkColumns}
          rowKey={entry => entry.userId}
          rows={links}
          empty={
            <EmptyState
              title="No Discord links yet"
              body="Pick a person and an account above and they’ll show up here."
            />
          }
        />
      </Panel>

      <ConfirmDialog
        open={isUnlinkOpen}
        onOpenChange={setIsUnlinkOpen}
        title={`Unlink ${unlinkTarget?.email ?? 'this person'} from @${unlinkTarget?.username ?? ''}?`}
        body="Their Discord downloads stop being attributed to them until you link them again."
        confirmLabel="Unlink"
        cancelLabel="Keep link"
        onConfirm={handleUnlinkConfirm}
      />
    </section>
  )
}
