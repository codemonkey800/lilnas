'use client'

import { cns } from '@lilnas/utils/cns'
import type { TransitionStartFunction } from 'react'
import { useMemo, useState } from 'react'

import { linkDiscordAccount, unlinkDiscordAccount } from 'src/app/admin/actions'
import type {
  AdminDiscordLinkEntry,
  AdminDiscordUnlinked,
  AdminDiscordUnlinkedAccount,
  AdminDiscordUnlinkedPerson,
} from 'src/app/admin/require-admin'
import { Icon } from 'src/app/components/icons'
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
// The two filter `input`s below are the ONLY inputs in the panel, and they
// only ever narrow an already-observed list; neither can contribute a value
// to the link call.
//
// Mutations follow the same shape as the two modals (add-person-modal.tsx,
// edit-access-modal.tsx): the parent hands down `isPending`/
// `startTransition`/`showToast`, and this component wraps its own calls in
// runPanelAction() below so a backend failure lands in THIS panel's own
// role="alert" line rather than the dashboard's page-level notice — the
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

  // Confirmed like every other destructive action on this dashboard (Remove
  // access, Sign out everywhere, blocking an admin). A 404 from this call is
  // a GENUINE error, deliberately not swallowed into a success — see
  // actions.ts's unlinkDiscordAccount() comment: reaching it means this view
  // is stale, and surfacing the message is what prompts the refresh that
  // makes the screen honest again.
  function handleUnlink(entry: AdminDiscordLinkEntry) {
    if (
      !window.confirm(
        `Unlink ${entry.email} from @${entry.username}? Their future Discord downloads will no longer be attributed to them until they are linked again.`,
      )
    ) {
      return
    }
    runPanelAction(async () => {
      await unlinkDiscordAccount(entry.userId)
      showToast(`Unlinked @${entry.username}`)
    })
  }

  return (
    <div className="stack gap-3.5">
      <div className="panel-head">
        <div className="row gap-2">
          <h2 className="h2">Discord links</h2>
          <span className="tab-count">{links.length}</span>
        </div>
      </div>

      <p className="body-text muted">
        Pair a person with a Discord account so their downloads are attributed
        to them. Both sides are picked from what this system has already seen —
        nothing here is typed by hand.
      </p>

      {panelError ? (
        <p role="alert" className="text-sm text-red-400">
          {panelError}
        </p>
      ) : null}

      {/* Side by side on a normal screen, stacked on a narrow one — the two
          lists are read together (pick a row on the left, pick its partner
          on the right), so they stay adjacent wherever there is room. */}
      <div className="card grid gap-5 p-4 md:grid-cols-2">
        <div className="field">
          <label id="discord-people-label">People without a Discord link</label>
          {people.length >= FILTER_MIN_ROWS ? (
            <input
              className="input"
              type="text"
              placeholder="Filter people…"
              aria-label="Filter people without a Discord link"
              value={peopleFilter}
              onChange={event => setPeopleFilter(event.target.value)}
            />
          ) : null}
          {people.length === 0 ? (
            <div className="empty-state px-2 py-6">
              <Icon name="check" />
              <p className="body-text">
                Everyone who has signed in is already linked.
              </p>
            </div>
          ) : (
            <div
              className="max-h-[280px] overflow-y-auto pr-0.5"
              role="radiogroup"
              aria-labelledby="discord-people-label"
            >
              {visiblePeople.map(person => (
                <label
                  key={person.userId}
                  className={cns(
                    'checkbox-row',
                    person.userId === selectedUserId &&
                      'border-accent bg-white/5',
                  )}
                >
                  <input
                    type="radio"
                    name="discord-link-person"
                    checked={person.userId === selectedUserId}
                    onChange={() => setSelectedUserId(person.userId)}
                    disabled={isPending}
                  />
                  <span className="stack min-w-0">
                    <span className="small truncate font-medium">
                      {person.name}
                    </span>
                    <span className="caption truncate">{person.email}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="field">
          <label id="discord-accounts-label">
            Discord accounts without a lilnas link
          </label>
          {accounts.length >= FILTER_MIN_ROWS ? (
            <input
              className="input"
              type="text"
              placeholder="Filter accounts…"
              aria-label="Filter Discord accounts without a lilnas link"
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
            <div className="empty-state px-2 py-6">
              <Icon name="inbox" />
              <p className="body-text">
                Discord accounts show up here the first time someone runs
                /download
              </p>
            </div>
          ) : (
            <div
              className="max-h-[280px] overflow-y-auto pr-0.5"
              role="radiogroup"
              aria-labelledby="discord-accounts-label"
            >
              {visibleAccounts.map(account => (
                <label
                  key={account.discordUserId}
                  className={cns(
                    'checkbox-row',
                    account.discordUserId === selectedDiscordUserId &&
                      'border-accent bg-white/5',
                  )}
                >
                  <input
                    type="radio"
                    name="discord-link-account"
                    checked={account.discordUserId === selectedDiscordUserId}
                    onChange={() =>
                      setSelectedDiscordUserId(account.discordUserId)
                    }
                    disabled={isPending}
                  />
                  <span className="stack min-w-0">
                    <span className="small truncate font-medium">
                      @{account.username}
                    </span>
                    {account.displayName ? (
                      <span className="caption truncate">
                        {account.displayName}
                      </span>
                    ) : null}
                    {/* suppressHydrationWarning for the same reason the
                        dashboard's request cards use it: timeAgo() reads
                        Date.now(), so the server's string and the client's
                        first render legitimately differ. */}
                    <span className="caption" suppressHydrationWarning>
                      last seen {timeAgo(account.lastSeenAt)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="row justify-end">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleLink}
          disabled={!selectedPerson || !selectedAccount || isPending}
        >
          {selectedPerson && selectedAccount
            ? `Link ${selectedPerson.email} ↔ @${selectedAccount.username}`
            : 'Link'}
        </button>
      </div>

      {links.length === 0 ? (
        <div className="empty-state">
          <Icon name="users" />
          <p className="body-text">No Discord accounts are linked yet.</p>
        </div>
      ) : (
        // Deliberately NOT wrapped in `people-table-wrap`: that class hides
        // the table outright below 768px and relies on a hand-written
        // `.person-card` list as the mobile rendering. This table has four
        // short columns and no such twin, so it scrolls horizontally on a
        // narrow screen instead of disappearing.
        <div className="card overflow-x-auto">
          <table className="table min-w-[560px]">
            <thead>
              <tr>
                <th>Person</th>
                <th>Discord</th>
                <th>Linked</th>
                <th>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {links.map(entry => (
                <tr key={entry.userId}>
                  <td>
                    <div className="row-user__text">
                      <span className="row-user__name">{entry.name}</span>
                      <span className="row-user__email">{entry.email}</span>
                    </div>
                  </td>
                  <td>
                    <span className="chip chip-neutral">@{entry.username}</span>
                  </td>
                  {/* Same hydration caveat as the last-seen line above —
                      toLocaleDateString() resolves against the renderer's own
                      locale and timezone, which the server and the browser
                      need not share. */}
                  <td className="caption" suppressHydrationWarning>
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <div className="table-row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm text-red-400 hover:bg-red-950/30 hover:text-red-300"
                        onClick={() => handleUnlink(entry)}
                        disabled={isPending}
                      >
                        Unlink
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
