import { expect, test } from '@playwright/test'

import { loginAs } from './helpers/auth'
import {
  seedCheckIn,
  seedCheckInQuestion,
  seedCheckInResponse,
  seedPartnership,
  seedProfile,
  seedTemplate,
  seedTemplateQuestion,
  seedUser,
  truncateAll,
} from './helpers/db'

// ---------------------------------------------------------------------------
// Check-in lifecycle E2E tests
// ---------------------------------------------------------------------------

const PASSWORD = 'testpassword123'

/**
 * Seed two onboarded users with an active partnership and a template with
 * two questions. Returns all the IDs needed for check-in tests.
 */
async function seedPair() {
  const alice = await seedUser({ email: 'alice@e2e.test', password: PASSWORD })
  await seedProfile(alice.id, { displayName: 'Alice' })

  const bob = await seedUser({ email: 'bob@e2e.test', password: PASSWORD })
  await seedProfile(bob.id, { displayName: 'Bob' })

  const partnership = await seedPartnership(alice.id, bob.id, 'accepted')

  const template = await seedTemplate(partnership.id, {
    name: 'Weekly Sync',
    createdById: alice.id,
  })
  await seedTemplateQuestion(template.id, {
    questionText: 'How are you feeling this week?',
    orderIndex: 0,
  })
  await seedTemplateQuestion(template.id, {
    questionText: 'What do you need from me?',
    orderIndex: 1,
  })

  return { alice, bob, partnership, template }
}

test.describe('Check-in lifecycle', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  // -------------------------------------------------------------------------
  // Creation flow
  // -------------------------------------------------------------------------

  test('create check-in from template → lands on draft view', async ({
    page,
  }) => {
    await seedPair()

    await loginAs(page, 'alice@e2e.test', PASSWORD)

    // Navigate to new check-in page
    await page.goto('/check-ins/new')
    await expect(
      page.getByRole('heading', { name: 'New Check-in' }),
    ).toBeVisible()

    // Select the "Weekly Sync" template
    await page.getByText('Weekly Sync').click()

    // Submit
    await page.getByRole('button', { name: 'Create Check-in' }).click()

    // Should redirect to the draft detail view
    await expect(page).toHaveURL(/\/check-ins\//, { timeout: 10_000 })
    await expect(page.getByText('Draft')).toBeVisible()
    await expect(page.getByText('How are you feeling this week?')).toBeVisible()
    await expect(page.getByText('What do you need from me?')).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // Full lifecycle: draft → start → confirm → in_progress → complete →
  //                 confirm → completed
  // -------------------------------------------------------------------------

  test('full lifecycle with two-person confirmation', async ({ browser }) => {
    const { alice, bob } = await seedPair()

    const ctxAlice = await browser.newContext()
    const ctxBob = await browser.newContext()
    const pageAlice = await ctxAlice.newPage()
    const pageBob = await ctxBob.newPage()

    // ---- Alice: Login & create a check-in ---------------------------------
    await loginAs(pageAlice, 'alice@e2e.test', PASSWORD)
    await pageAlice.goto('/check-ins/new')
    await pageAlice.getByText('Weekly Sync').click()
    await pageAlice.getByRole('button', { name: 'Create Check-in' }).click()
    await expect(pageAlice).toHaveURL(/\/check-ins\//, { timeout: 10_000 })

    // Capture the check-in URL so Bob can visit it
    const checkInUrl = pageAlice.url()

    // ---- Alice: Fill in answers in draft view -----------------------------
    const aliceTextareas = pageAlice.locator('textarea')
    await aliceTextareas.nth(0).fill('Feeling great this week!')
    await aliceTextareas.nth(1).fill('More quality time together')

    // Wait for auto-save debounce (1s) to fire
    await pageAlice.waitForTimeout(1500)

    // ---- Alice: Start the check-in (opens dialog) -------------------------
    await pageAlice.getByRole('button', { name: 'Start Check-in' }).click()

    // Confirmation dialog
    await expect(
      pageAlice.getByRole('heading', { name: 'Start check-in?' }),
    ).toBeVisible()
    await pageAlice
      .locator('dialog')
      .getByRole('button', { name: 'Start' })
      .click()

    // ---- Alice: Sees pending banner (she's the initiator) -----------------
    await expect(pageAlice.getByText('Waiting for Bob to confirm')).toBeVisible(
      { timeout: 10_000 },
    )

    // ---- Bob: Login & navigate to the same check-in -----------------------
    await loginAs(pageBob, 'bob@e2e.test', PASSWORD)

    // Navigate via the check-ins list page to avoid any stale SSR cache
    // from Alice's revalidatePath on the detail URL
    await pageBob.goto('/check-ins')
    await pageBob.getByRole('link', { name: /Weekly Sync/i }).click()
    await expect(pageBob).toHaveURL(/\/check-ins\//, { timeout: 10_000 })

    // Bob sees the confirmation banner (he's the partner)
    await expect(
      pageBob.getByText('Alice wants to start this check-in'),
    ).toBeVisible({ timeout: 10_000 })

    // ---- Bob: Confirm the start transition --------------------------------
    await pageBob.getByRole('button', { name: 'Confirm' }).click()

    // Check-in should now be "In Progress"
    await expect(pageBob.getByText('In Progress')).toBeVisible({
      timeout: 10_000,
    })

    // ---- Alice: Refresh → should also see "In Progress" -------------------
    await pageAlice.reload()
    await expect(pageAlice.getByText('In Progress')).toBeVisible({
      timeout: 10_000,
    })

    // ---- Bob: Fill in his answers -----------------------------------------
    const bobTextareas = pageBob.locator('textarea')
    await bobTextareas.nth(0).fill('Doing well, thanks for asking!')
    await bobTextareas.nth(1).fill('A date night would be nice')

    // Wait for auto-save
    await pageBob.waitForTimeout(1500)

    // ---- Alice: Complete the check-in -------------------------------------
    await pageAlice.reload()
    await pageAlice.getByRole('button', { name: 'Complete Check-in' }).click()

    // Confirmation dialog
    await expect(
      pageAlice.getByRole('heading', { name: 'Complete check-in?' }),
    ).toBeVisible()
    await pageAlice
      .locator('dialog')
      .getByRole('button', { name: 'Complete' })
      .click()

    // ---- Alice: Sees pending complete banner ------------------------------
    await expect(pageAlice.getByText('Waiting for Bob to confirm')).toBeVisible(
      { timeout: 10_000 },
    )

    // ---- Bob: Reload → sees confirmation banner ---------------------------
    await pageBob.reload()
    await expect(
      pageBob.getByText('Alice wants to complete this check-in'),
    ).toBeVisible({ timeout: 10_000 })

    // ---- Bob: Confirm completion ------------------------------------------
    await pageBob.getByRole('button', { name: 'Confirm' }).click()

    // Check-in should now be "Completed"
    await expect(pageBob.getByText('Completed', { exact: true })).toBeVisible({
      timeout: 10_000,
    })

    // Both partners' answers should be visible in the results view
    await expect(pageBob.getByText('Feeling great this week!')).toBeVisible()
    await expect(
      pageBob.getByText('Doing well, thanks for asking!'),
    ).toBeVisible()

    // ---- Alice: Refresh → should see completed view -----------------------
    await pageAlice.reload()
    await expect(pageAlice.getByText('Completed', { exact: true })).toBeVisible(
      {
        timeout: 10_000,
      },
    )
    await expect(
      pageAlice.getByText('More quality time together'),
    ).toBeVisible()
    await expect(
      pageAlice.getByText('A date night would be nice'),
    ).toBeVisible()

    // ---- Cleanup ----------------------------------------------------------
    await ctxAlice.close()
    await ctxBob.close()
  })

  // -------------------------------------------------------------------------
  // Cancel a pending transition
  // -------------------------------------------------------------------------

  test('cancel pending start transition', async ({ page }) => {
    await seedPair()

    await loginAs(page, 'alice@e2e.test', PASSWORD)

    // Create a check-in
    await page.goto('/check-ins/new')
    await page.getByText('Weekly Sync').click()
    await page.getByRole('button', { name: 'Create Check-in' }).click()
    await expect(page).toHaveURL(/\/check-ins\//, { timeout: 10_000 })

    // Start → confirm dialog → submit
    await page.getByRole('button', { name: 'Start Check-in' }).click()
    await expect(
      page.getByRole('heading', { name: 'Start check-in?' }),
    ).toBeVisible()
    await page.locator('dialog').getByRole('button', { name: 'Start' }).click()

    // See pending banner
    await expect(page.getByText('Waiting for Bob to confirm')).toBeVisible({
      timeout: 10_000,
    })

    // Cancel the request
    await page.getByRole('button', { name: 'Cancel request' }).click()

    // Banner should disappear, start button should be re-enabled
    await expect(page.getByText('Waiting for Bob to confirm')).toBeHidden({
      timeout: 10_000,
    })
    await expect(
      page.getByRole('button', { name: 'Start Check-in' }),
    ).toBeEnabled()
  })

  // -------------------------------------------------------------------------
  // Re-open a completed check-in
  // -------------------------------------------------------------------------

  test('re-open completed check-in with partner confirmation', async ({
    browser,
  }) => {
    // Seed a completed check-in directly via DB helpers
    const { alice, bob, partnership, template } = await seedPair()

    const checkIn = await seedCheckIn(partnership.id, alice.id, {
      title: 'Completed Check-in',
      templateId: template.id,
      status: 'completed',
      startedAt: new Date(),
      completedAt: new Date(),
    })

    const q1 = await seedCheckInQuestion(checkIn.id, {
      questionText: 'How are you feeling this week?',
      orderIndex: 0,
    })
    const q2 = await seedCheckInQuestion(checkIn.id, {
      questionText: 'What do you need from me?',
      orderIndex: 1,
    })

    // Seed responses (not draft since check-in is completed)
    await seedCheckInResponse(q1.id, alice.id, {
      responseText: "Alice's answer to Q1",
      isDraft: false,
    })
    await seedCheckInResponse(q1.id, bob.id, {
      responseText: "Bob's answer to Q1",
      isDraft: false,
    })
    await seedCheckInResponse(q2.id, alice.id, {
      responseText: "Alice's answer to Q2",
      isDraft: false,
    })
    await seedCheckInResponse(q2.id, bob.id, {
      responseText: "Bob's answer to Q2",
      isDraft: false,
    })

    const ctxAlice = await browser.newContext()
    const ctxBob = await browser.newContext()
    const pageAlice = await ctxAlice.newPage()
    const pageBob = await ctxBob.newPage()

    // ---- Alice: Navigate to completed check-in ----------------------------
    await loginAs(pageAlice, 'alice@e2e.test', PASSWORD)
    await pageAlice.goto(`/check-ins/${checkIn.id}`)
    await expect(pageAlice.getByText('Completed', { exact: true })).toBeVisible(
      {
        timeout: 10_000,
      },
    )

    // ---- Alice: Click Re-open → confirm dialog ----------------------------
    await pageAlice.getByRole('button', { name: 'Re-open' }).click()
    await expect(
      pageAlice.getByRole('heading', { name: 'Re-open check-in?' }),
    ).toBeVisible()
    await pageAlice
      .locator('dialog')
      .getByRole('button', { name: 'Re-open' })
      .click()

    // ---- Alice: Sees pending re-open banner -------------------------------
    await expect(pageAlice.getByText('Waiting for Bob to confirm')).toBeVisible(
      { timeout: 10_000 },
    )

    // ---- Bob: Navigate → sees banner, confirms ----------------------------
    await loginAs(pageBob, 'bob@e2e.test', PASSWORD)
    await pageBob.goto(`/check-ins/${checkIn.id}`)

    await expect(
      pageBob.getByText('Alice wants to re-open this check-in'),
    ).toBeVisible({ timeout: 10_000 })

    await pageBob.getByRole('button', { name: 'Confirm' }).click()

    // Check-in should now be "In Progress"
    await expect(pageBob.getByText('In Progress')).toBeVisible({
      timeout: 10_000,
    })

    // ---- Alice: Reload → should see In Progress ---------------------------
    await pageAlice.reload()
    await expect(pageAlice.getByText('In Progress')).toBeVisible({
      timeout: 10_000,
    })

    // ---- Cleanup ----------------------------------------------------------
    await ctxAlice.close()
    await ctxBob.close()
  })
})
