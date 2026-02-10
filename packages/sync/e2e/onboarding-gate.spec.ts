import { expect, test } from '@playwright/test'

import { loginAs } from './helpers/auth'
import { seedUser, truncateAll } from './helpers/db'

// ---------------------------------------------------------------------------
// Onboarding gate — users without completed onboarding are redirected
// ---------------------------------------------------------------------------

const PASSWORD = 'testpassword123'

test.describe('Onboarding gate', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('user without profile is redirected to /onboarding', async ({
    page,
  }) => {
    // Seed user with no profile at all
    await seedUser({ email: 'noprofile@e2e.test', password: PASSWORD })

    await loginAs(page, 'noprofile@e2e.test', PASSWORD)

    // The (app) layout should redirect to /onboarding
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 })
  })

  test('completing onboarding allows access to the app', async ({ page }) => {
    await seedUser({ email: 'onboard@e2e.test', password: PASSWORD })

    await loginAs(page, 'onboard@e2e.test', PASSWORD)

    // Should be on onboarding page
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 })

    // Step 1: About You
    await page.getByPlaceholder('Your name').fill('Onboarding Tester')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 2: Love & Connection — skip
    await page.getByRole('button', { name: 'Continue' }).click()

    // Step 3: Goals — submit
    await page.getByRole('button', { name: 'Get Started' }).click()

    // Should land on the partner page (no active partnership)
    await expect(page).toHaveURL(/\/partner/, { timeout: 10_000 })
    await expect(
      page.getByRole('heading', { name: 'Connect with your partner' }),
    ).toBeVisible()
  })
})
