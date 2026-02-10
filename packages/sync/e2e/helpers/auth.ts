import type { Page } from '@playwright/test'

/**
 * Log in via the UI by navigating to /login, filling the form, and submitting.
 * Waits until the browser navigates away from /login before returning.
 */
export async function loginAs(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login')

  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Wait until we leave the login page (successful login redirects away)
  await page.waitForURL(url => !url.pathname.startsWith('/login'), {
    timeout: 10_000,
  })
}
