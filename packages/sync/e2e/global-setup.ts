/**
 * Playwright global setup.
 *
 * Schema is pushed to the test database by `drizzle-kit push` in
 * scripts/test-e2e.sh before Playwright starts — no manual SQL needed here.
 *
 * This file is kept as the global setup entry-point for any future
 * one-time setup tasks (seed data, service health-checks, etc.).
 */
export default async function globalSetup() {
  // Schema is already applied by `drizzle-kit push --force` in the test script.
  // Add any additional one-time e2e setup here if needed.
}
