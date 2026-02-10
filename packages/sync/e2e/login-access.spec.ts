import { expect, test } from '@playwright/test'

import { loginAs } from './helpers/auth'
import {
  seedPartnership,
  seedProfile,
  seedUser,
  truncateAll,
} from './helpers/db'

// ---------------------------------------------------------------------------
// Login & route protection
// ---------------------------------------------------------------------------

const PASSWORD = 'testpassword123'

test.describe('Login & access control', () => {
  test.beforeEach(async () => {
    await truncateAll()
  })

  test('valid login reaches dashboard', async ({ page }) => {
    // Seed a fully-onboarded user with an active partnership so they land on
    // the dashboard (not redirected to /partner).
    const userA = await seedUser({
      email: 'alice@e2e.test',
      password: PASSWORD,
    })
    await seedProfile(userA.id, { displayName: 'Alice' })

    const userB = await seedUser({ email: 'bob@e2e.test', password: PASSWORD })
    await seedProfile(userB.id, { displayName: 'Bob' })

    await seedPartnership(userA.id, userB.id, 'accepted')

    await loginAs(page, 'alice@e2e.test', PASSWORD)

    // Should land on the dashboard with partner card
    await expect(page).toHaveURL('/', { timeout: 10_000 })
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  test('invalid credentials show error', async ({ page }) => {
    await seedUser({ email: 'user@e2e.test', password: PASSWORD })

    await page.goto('/login')
    await page.getByLabel('Email address').fill('user@e2e.test')
    await page.getByLabel('Password').fill('wrongpassword')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByText('Invalid email or password.')).toBeVisible()

    // Should stay on login page
    await expect(page).toHaveURL(/\/login/)
  })

  test('unauthenticated user is redirected to /login from protected route', async ({
    page,
  }) => {
    await page.goto('/partner')

    // Middleware redirects to /login
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
  })

  test('authenticated user on /login is redirected to /', async ({ page }) => {
    const user = await seedUser({
      email: 'authed@e2e.test',
      password: PASSWORD,
    })
    await seedProfile(user.id, { displayName: 'Authed User' })

    const userB = await seedUser({
      email: 'partner@e2e.test',
      password: PASSWORD,
    })
    await seedProfile(userB.id, { displayName: 'Partner' })
    await seedPartnership(user.id, userB.id, 'accepted')

    // Login first
    await loginAs(page, 'authed@e2e.test', PASSWORD)
    await expect(page).toHaveURL('/', { timeout: 10_000 })

    // Now try to go to /login — middleware should redirect back to /
    await page.goto('/login')
    await expect(page).toHaveURL('/', { timeout: 10_000 })
  })
})
