import { expect, test } from '@playwright/test'

import { loginAs } from './helpers/auth'
import {
  seedActionItem,
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
// Action items E2E tests
// ---------------------------------------------------------------------------

const PASSWORD = 'testpassword123'

/**
 * Seed two onboarded users with an active partnership and an in-progress
 * check-in with two questions. Returns all IDs needed for action item tests.
 */
async function seedInProgressCheckIn() {
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
    questionText: 'How are you feeling?',
    orderIndex: 0,
  })
  await seedTemplateQuestion(template.id, {
    questionText: 'What do you need?',
    orderIndex: 1,
  })

  const checkIn = await seedCheckIn(partnership.id, alice.id, {
    title: 'Action Items Test',
    templateId: template.id,
    status: 'in_progress',
    startedAt: new Date(),
  })

  const q1 = await seedCheckInQuestion(checkIn.id, {
    questionText: 'How are you feeling?',
    orderIndex: 0,
  })
  const q2 = await seedCheckInQuestion(checkIn.id, {
    questionText: 'What do you need?',
    orderIndex: 1,
  })

  // Add responses for both partners so partner info is available for the form
  await seedCheckInResponse(q1.id, alice.id, {
    responseText: "Alice's answer",
    isDraft: false,
  })
  await seedCheckInResponse(q1.id, bob.id, {
    responseText: "Bob's answer",
    isDraft: false,
  })

  return { alice, bob, partnership, checkIn, q1, q2 }
}

test.describe('Action items', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  // -------------------------------------------------------------------------
  // Create action items with different ownership
  // -------------------------------------------------------------------------

  test('create action item assigned to self', async ({ page }) => {
    const { checkIn } = await seedInProgressCheckIn()

    await loginAs(page, 'alice@e2e.test', PASSWORD)
    await page.goto(`/check-ins/${checkIn.id}`)

    await expect(page.getByText('In Progress')).toBeVisible({
      timeout: 10_000,
    })

    // Open the action item form on the first question
    const addButtons = page.getByRole('button', { name: 'Add action item' })
    await addButtons.first().click()

    // Fill in description
    await page.getByPlaceholder('What needs to be done?').fill('Buy flowers')

    // "Me" should be selected by default — submit
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    // Verify the action item appears
    await expect(page.getByText('Buy flowers')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText('You', { exact: true })).toBeVisible()
  })

  test('create action item assigned to partner', async ({ page }) => {
    const { checkIn } = await seedInProgressCheckIn()

    await loginAs(page, 'alice@e2e.test', PASSWORD)
    await page.goto(`/check-ins/${checkIn.id}`)

    await expect(page.getByText('In Progress')).toBeVisible({
      timeout: 10_000,
    })

    // Open the action item form
    const addButtons = page.getByRole('button', { name: 'Add action item' })
    await addButtons.first().click()

    // Fill in description
    await page
      .getByPlaceholder('What needs to be done?')
      .fill('Plan date night')

    // Select Bob as owner
    await page.getByRole('button', { name: 'Bob' }).click()

    // Submit
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    // Verify the action item appears with Bob's name
    await expect(page.getByText('Plan date night')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText('Bob')).toBeVisible()
  })

  test('create shared action item (both)', async ({ page }) => {
    const { checkIn } = await seedInProgressCheckIn()

    await loginAs(page, 'alice@e2e.test', PASSWORD)
    await page.goto(`/check-ins/${checkIn.id}`)

    await expect(page.getByText('In Progress')).toBeVisible({
      timeout: 10_000,
    })

    // Open the action item form
    const addButtons = page.getByRole('button', { name: 'Add action item' })
    await addButtons.first().click()

    // Fill in description
    await page
      .getByPlaceholder('What needs to be done?')
      .fill('Go on a hike together')

    // Select "Both of us"
    await page.getByRole('button', { name: 'Both of us' }).click()

    // Submit
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    // Verify the action item appears with "Both" badge
    await expect(page.getByText('Go on a hike together')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText('Both')).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // Toggle action item status
  // -------------------------------------------------------------------------

  test('toggle action item status: open → in_progress → completed', async ({
    page,
  }) => {
    const { alice, checkIn, q1 } = await seedInProgressCheckIn()

    // Seed an action item so it's already present
    await seedActionItem(checkIn.id, q1.id, alice.id, {
      description: 'Follow up on conversation',
      ownerType: 'individual',
      ownerId: alice.id,
      status: 'open',
    })

    await loginAs(page, 'alice@e2e.test', PASSWORD)
    await page.goto(`/check-ins/${checkIn.id}`)

    await expect(page.getByText('Follow up on conversation')).toBeVisible({
      timeout: 10_000,
    })

    // Status starts as "open" → toggle button says "Mark as in_progress"
    const toggleButton = page.getByRole('button', {
      name: 'Mark as in_progress',
    })
    await expect(toggleButton).toBeVisible()

    // Toggle to in_progress
    await toggleButton.click()

    // Now button should say "Mark as completed"
    await expect(
      page.getByRole('button', { name: 'Mark as completed' }),
    ).toBeVisible({ timeout: 5_000 })

    // Toggle to completed
    await page.getByRole('button', { name: 'Mark as completed' }).click()

    // Now button should say "Mark as open" (cycle back)
    await expect(
      page.getByRole('button', { name: 'Mark as open' }),
    ).toBeVisible({ timeout: 5_000 })
  })

  // -------------------------------------------------------------------------
  // Delete action item
  // -------------------------------------------------------------------------

  test('delete action item during in-progress check-in', async ({ page }) => {
    const { alice, checkIn, q1 } = await seedInProgressCheckIn()

    await seedActionItem(checkIn.id, q1.id, alice.id, {
      description: 'Item to delete',
      ownerType: 'individual',
      ownerId: alice.id,
      status: 'open',
    })

    await loginAs(page, 'alice@e2e.test', PASSWORD)
    await page.goto(`/check-ins/${checkIn.id}`)

    // Verify the item is there
    await expect(page.getByText('Item to delete')).toBeVisible({
      timeout: 10_000,
    })

    // Click the delete button
    await page
      .getByRole('button', { name: 'Delete action item' })
      .first()
      .click()

    // Verify the item disappears
    await expect(page.getByText('Item to delete')).toBeHidden({
      timeout: 10_000,
    })
  })
})
