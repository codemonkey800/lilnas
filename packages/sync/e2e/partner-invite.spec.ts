import { expect, test } from '@playwright/test'

import { loginAs } from './helpers/auth'
import {
  seedPartnership,
  seedProfile,
  seedUser,
  truncateAll,
} from './helpers/db'

// ---------------------------------------------------------------------------
// Partner invite E2E tests
// ---------------------------------------------------------------------------

const PASSWORD = 'testpassword123'

test.describe('Partner invite flow', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  // -------------------------------------------------------------------------
  // Send invite → partner accepts
  // -------------------------------------------------------------------------

  test('send invite and partner accepts', async ({ browser }) => {
    // Seed two onboarded users without a partnership
    const alice = await seedUser({
      email: 'alice@e2e.test',
      password: PASSWORD,
    })
    await seedProfile(alice.id, { displayName: 'Alice' })

    const bob = await seedUser({ email: 'bob@e2e.test', password: PASSWORD })
    await seedProfile(bob.id, { displayName: 'Bob' })

    const ctxAlice = await browser.newContext()
    const ctxBob = await browser.newContext()
    const pageAlice = await ctxAlice.newPage()
    const pageBob = await ctxBob.newPage()

    // ---- Alice: Login & navigate to partner page ----------------------------
    await loginAs(pageAlice, 'alice@e2e.test', PASSWORD)
    await pageAlice.goto('/partner')

    // Should see the invite form
    await expect(
      pageAlice.getByRole('heading', { name: 'Connect with your partner' }),
    ).toBeVisible({ timeout: 10_000 })

    // ---- Alice: Send invite to Bob ------------------------------------------
    await pageAlice.getByPlaceholder('partner@example.com').fill('bob@e2e.test')
    await pageAlice.getByRole('button', { name: /send invite/i }).click()

    // Should transition to the pending outgoing view
    await expect(
      pageAlice.getByRole('heading', { name: 'Invite sent' }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(pageAlice.getByText('bob@e2e.test')).toBeVisible()

    // ---- Bob: Login & navigate to partner page ------------------------------
    await loginAs(pageBob, 'bob@e2e.test', PASSWORD)
    await pageBob.goto('/partner')

    // Bob should see the incoming invite from Alice
    await expect(
      pageBob.getByRole('heading', {
        name: 'You have a connection request',
      }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(pageBob.getByText('Alice', { exact: true })).toBeVisible()

    // ---- Bob: Accept the invite ---------------------------------------------
    await pageBob.getByRole('button', { name: /accept/i }).click()

    // Bob should be redirected to the home page
    await expect(pageBob).toHaveURL('/', { timeout: 10_000 })

    // ---- Alice: Refresh → should be redirected to home ----------------------
    await pageAlice.goto('/partner')
    await expect(pageAlice).toHaveURL('/', { timeout: 10_000 })

    // ---- Cleanup ------------------------------------------------------------
    await ctxAlice.close()
    await ctxBob.close()
  })

  // -------------------------------------------------------------------------
  // Send invite → cancel it
  // -------------------------------------------------------------------------

  test('send invite and cancel it', async ({ page }) => {
    const alice = await seedUser({
      email: 'alice@e2e.test',
      password: PASSWORD,
    })
    await seedProfile(alice.id, { displayName: 'Alice' })

    // Bob needs to exist so the invite can be created
    const bob = await seedUser({ email: 'bob@e2e.test', password: PASSWORD })
    await seedProfile(bob.id, { displayName: 'Bob' })

    await loginAs(page, 'alice@e2e.test', PASSWORD)
    await page.goto('/partner')

    // Send invite
    await expect(
      page.getByRole('heading', { name: 'Connect with your partner' }),
    ).toBeVisible({ timeout: 10_000 })
    await page.getByPlaceholder('partner@example.com').fill('bob@e2e.test')
    await page.getByRole('button', { name: /send invite/i }).click()

    // Should see pending view
    await expect(
      page.getByRole('heading', { name: 'Invite sent' }),
    ).toBeVisible({ timeout: 10_000 })

    // Cancel the invite
    await page.getByRole('button', { name: /cancel invite/i }).click()

    // Should return to the invite form
    await expect(
      page.getByRole('heading', { name: 'Connect with your partner' }),
    ).toBeVisible({ timeout: 10_000 })
  })

  // -------------------------------------------------------------------------
  // Decline an incoming invite
  // -------------------------------------------------------------------------

  test('decline an incoming invite', async ({ page }) => {
    // Seed a pending partnership (Alice invited Bob) via DB
    const alice = await seedUser({
      email: 'alice@e2e.test',
      password: PASSWORD,
    })
    await seedProfile(alice.id, { displayName: 'Alice' })

    const bob = await seedUser({ email: 'bob@e2e.test', password: PASSWORD })
    await seedProfile(bob.id, { displayName: 'Bob' })

    await seedPartnership(alice.id, bob.id, 'pending')

    // Bob logs in and sees the incoming invite
    await loginAs(page, 'bob@e2e.test', PASSWORD)
    await page.goto('/partner')

    await expect(
      page.getByRole('heading', {
        name: 'You have a connection request',
      }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Alice', { exact: true })).toBeVisible()

    // Bob declines
    await page.getByRole('button', { name: /decline/i }).click()

    // Invite should disappear and Bob should see the invite form
    await expect(
      page.getByRole('heading', { name: 'Connect with your partner' }),
    ).toBeVisible({ timeout: 10_000 })
  })
})
