// Setup module for the jsdom Jest project only (wired via that project's
// `setupFilesAfterEnv` in jest.config.js). The backend/node project has no
// DOM concerns and deliberately does not load this — see jest.config.js for
// why the two projects are split at all.
//
// Importing jest-dom for its side effect registers the DOM matchers
// (toBeInTheDocument, toHaveAttribute, toHaveClass, ...) on `expect` for
// every test in the jsdom project. Because this file is also part of the
// app's tsconfig program, its module augmentation is what makes those
// matchers type-check in the .tsx specs as well.
import '@testing-library/jest-dom'
