// Frontend-project Jest setup (jsdom environment) — deliberately separate
// from src/__tests__/setup.ts (the backend/node-environment setup), which
// mocks discord.js/necord/node:child_process and other backend-only
// concerns that have no bearing on, and should not load for, this
// component test. See jest.config.js's header comment for why this is a
// distinct Jest PROJECT rather than a shared environment, and for why
// middleware.spec.ts (this app's OTHER new U6 test file) deliberately runs
// under the backend/node project instead of here — it needs the Fetch API
// globals (Request/Response/Headers) that next/server depends on, which
// jest-environment-jsdom does not provide, rather than any DOM API this
// setup file's jsdom environment exists to offer.
import '@testing-library/jest-dom'
