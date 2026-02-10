import { expect, test } from '@playwright/test'

import { loginAs } from './helpers/auth'
import { seedProfile, seedUser, truncateAll } from './helpers/db'

// ---------------------------------------------------------------------------
// Partner connection lifecycle (two browser contexts)
// ---------------------------------------------------------------------------

const PASSWORD = 'testpassword123'

test.describe('Partner lifecycle', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('send invite → accept → dashboard → unlink', async ({ browser }) => {
    // ---- Seed two onboarded users (no partnership yet) --------------------
    const alice = await seedUser({
      email: 'alice@e2e.test',
      password: PASSWORD,
    })
    await seedProfile(alice.id, { displayName: 'Alice' })

    const bob = await seedUser({
      email: 'bob@e2e.test',
      password: PASSWORD,
    })
    await seedProfile(bob.id, { displayName: 'Bob' })

    // ---- Create two independent browser contexts --------------------------
    const ctxAlice = await browser.newContext()
    const ctxBob = await browser.newContext()

    const pageAlice = await ctxAlice.newPage()
    const pageBob = await ctxBob.newPage()

    // ---- Alice: Login → /partner (no partner yet) -------------------------
    await loginAs(pageAlice, 'alice@e2e.test', PASSWORD)
    await expect(pageAlice).toHaveURL(/\/partner/, { timeout: 10_000 })
    await expect(
      pageAlice.getByRole('heading', { name: 'Connect with your partner' }),
    ).toBeVisible()

    // ---- Alice: Send invite to Bob ----------------------------------------
    await pageAlice.getByPlaceholder('partner@example.com').fill('bob@e2e.test')
    await pageAlice.getByRole('button', { name: 'Send Invite' }).click()

    // Verify pending state
    await expect(
      pageAlice.getByRole('heading', { name: 'Invite sent' }),
    ).toBeVisible()
    await expect(pageAlice.getByText('bob@e2e.test')).toBeVisible()

    // ---- Bob: Login → /partner (sees incoming invite) ---------------------
    await loginAs(pageBob, 'bob@e2e.test', PASSWORD)
    await expect(pageBob).toHaveURL(/\/partner/, { timeout: 10_000 })

    await expect(
      pageBob.getByRole('heading', { name: 'You have a connection request' }),
    ).toBeVisible()
    await expect(pageBob.getByText('Alice', { exact: true })).toBeVisible()

    // ---- Bob: Accept invite -----------------------------------------------
    await pageBob.getByRole('button', { name: 'Accept' }).click()

    // Bob should be redirected to the dashboard with Alice's partner card
    await expect(pageBob).toHaveURL('/', { timeout: 10_000 })
    await expect(
      pageBob.getByRole('heading', { name: 'Dashboard' }),
    ).toBeVisible()
    await expect(pageBob.getByText('Alice', { exact: true })).toBeVisible()

    // ---- Alice: Refresh → should now be on dashboard ----------------------
    await pageAlice.goto('/')
    await expect(pageAlice).toHaveURL('/', { timeout: 10_000 })
    await expect(
      pageAlice.getByRole('heading', { name: 'Dashboard' }),
    ).toBeVisible()
    await expect(pageAlice.getByText('Bob', { exact: true })).toBeVisible()

    // ---- Alice: Unlink from Bob -------------------------------------------
    await pageAlice.getByRole('button', { name: 'Unlink' }).click()

    // Confirm dialog appears
    await expect(pageAlice.getByText('Unlink from Bob?')).toBeVisible()
    await pageAlice.getByRole('button', { name: 'Unlink' }).last().click()

    // Alice should be redirected to /partner
    await expect(pageAlice).toHaveURL(/\/partner/, { timeout: 10_000 })
    await expect(
      pageAlice.getByRole('heading', { name: 'Connect with your partner' }),
    ).toBeVisible()

    // ---- Cleanup contexts -------------------------------------------------
    await ctxAlice.close()
    await ctxBob.close()
  })

  test('send invite → cancel', async ({ page }) => {
    const alice = await seedUser({
      email: 'alice@e2e.test',
      password: PASSWORD,
    })
    await seedProfile(alice.id, { displayName: 'Alice' })

    const bob = await seedUser({
      email: 'bob@e2e.test',
      password: PASSWORD,
    })
    await seedProfile(bob.id, { displayName: 'Bob' })

    await loginAs(page, 'alice@e2e.test', PASSWORD)
    await expect(page).toHaveURL(/\/partner/, { timeout: 10_000 })

    // Send invite
    await page.getByPlaceholder('partner@example.com').fill('bob@e2e.test')
    await page.getByRole('button', { name: 'Send Invite' }).click()

    await expect(
      page.getByRole('heading', { name: 'Invite sent' }),
    ).toBeVisible()

    // Cancel invite
    await page.getByRole('button', { name: 'Cancel Invite' }).click()

    // Should be back to the invite form
    await expect(
      page.getByRole('heading', { name: 'Connect with your partner' }),
    ).toBeVisible()
  })

  test('decline invite shows invite form', async ({ browser }) => {
    const alice = await seedUser({
      email: 'alice@e2e.test',
      password: PASSWORD,
    })
    await seedProfile(alice.id, { displayName: 'Alice' })

    const bob = await seedUser({
      email: 'bob@e2e.test',
      password: PASSWORD,
    })
    await seedProfile(bob.id, { displayName: 'Bob' })

    const ctxAlice = await browser.newContext()
    const ctxBob = await browser.newContext()

    const pageAlice = await ctxAlice.newPage()
    const pageBob = await ctxBob.newPage()

    // Alice sends invite
    await loginAs(pageAlice, 'alice@e2e.test', PASSWORD)
    await pageAlice.getByPlaceholder('partner@example.com').fill('bob@e2e.test')
    await pageAlice.getByRole('button', { name: 'Send Invite' }).click()
    await expect(
      pageAlice.getByRole('heading', { name: 'Invite sent' }),
    ).toBeVisible()

    // Bob declines
    await loginAs(pageBob, 'bob@e2e.test', PASSWORD)
    await expect(
      pageBob.getByRole('heading', { name: 'You have a connection request' }),
    ).toBeVisible()

    await pageBob.getByRole('button', { name: 'Decline' }).click()

    // Bob should see the invite form (no more incoming invites)
    await expect(
      pageBob.getByRole('heading', { name: 'Connect with your partner' }),
    ).toBeVisible()

    await ctxAlice.close()
    await ctxBob.close()
  })
})
