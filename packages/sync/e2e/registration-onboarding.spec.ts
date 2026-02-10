import { expect, test } from '@playwright/test'

import { truncateAll } from './helpers/db'

// ---------------------------------------------------------------------------
// Registration → Login → Onboarding → Partner page (golden path)
// ---------------------------------------------------------------------------

const TEST_EMAIL = 'newuser@e2e.test'
const TEST_PASSWORD = 'testpassword123'

test.describe('Registration → Onboarding (golden path)', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('register, login, complete onboarding, land on partner page', async ({
    page,
  }) => {
    // ----- Step 1: Register ------------------------------------------------
    await page.goto('/register')

    await expect(
      page.getByRole('heading', { name: 'Create your account' }),
    ).toBeVisible()

    await page.getByLabel('Email address').fill(TEST_EMAIL)
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD)

    await page.getByRole('button', { name: 'Create account' }).click()

    // Wait for success state
    await expect(
      page.getByRole('heading', { name: 'Account created!' }),
    ).toBeVisible()
    await expect(
      page.getByText('You can now sign in with your credentials.'),
    ).toBeVisible()

    // ----- Step 2: Navigate to login ---------------------------------------
    await page.getByText('Continue to sign in').click()
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })

    // ----- Step 3: Login ---------------------------------------------------
    await page.getByLabel('Email address').fill(TEST_EMAIL)
    await page.getByLabel('Password').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Should redirect to /onboarding (no profile yet)
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 })

    // ----- Step 4: Onboarding — Step 1 (About You) -------------------------
    await expect(page.getByRole('heading', { name: 'About You' })).toBeVisible()

    await page.getByPlaceholder('Your name').fill('E2E Tester')

    await page.getByRole('button', { name: 'Continue' }).click()

    // ----- Step 5: Onboarding — Step 2 (Love & Connection) -----------------
    await expect(
      page.getByRole('heading', { name: 'Love & Connection' }),
    ).toBeVisible()

    // Optional fields — just click Continue
    await page.getByRole('button', { name: 'Continue' }).click()

    // ----- Step 6: Onboarding — Step 3 (Goals) -----------------------------
    await expect(
      page.getByRole('heading', { name: 'What brings you to Sync?' }),
    ).toBeVisible()

    // Optional — submit without selecting goals
    await page.getByRole('button', { name: 'Get Started' }).click()

    // ----- Step 7: Land on the partner page (no active partnership) ---------
    await expect(page).toHaveURL(/\/partner/, { timeout: 10_000 })
    await expect(
      page.getByRole('heading', { name: 'Connect with your partner' }),
    ).toBeVisible()
  })
})
