// Frontend-project Jest setup (jsdom environment) — deliberately separate
// from the backend/node-environment test suite, which has no DOM concerns
// at all. Mirrors apps/tdr-code/src/app/__tests__/setup.ts's identical
// role for this app's own first component test (U6's pending page).
import '@testing-library/jest-dom'
