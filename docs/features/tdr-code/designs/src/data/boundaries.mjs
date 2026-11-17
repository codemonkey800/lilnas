// Copy and sample data for boundaries.pug. Two boundaries: error.tsx (a
// render error inside one page, the nav still there) and global-error.tsx (the
// root layout itself failed, so nothing from the design system exists).

export const segment = {
  lead: 'This page hit an error.',
  detail: 'The nav still works. Try again, or open another page.',
  code: "TypeError: Cannot read properties of undefined (reading 'items')",
  digest: 'digest 2849163057',
  action: 'Try again',
}

export const global = {
  heading: "tdr-code hit an error it couldn't recover from.",
  body: 'Try again. If it keeps happening, check the backend log.',
  action: 'Try again',
}

// The literal values global-error.tsx has to inline. It renders when the root
// layout failed, so Tailwind's CSS, the Geist font and every component are
// gone: these come from foundations.md's @theme block, copied by hand.
export const inlineValues = [
  ['background', '#0e0c14', '--color-bg'],
  ['text', '#ebe8f2', '--color-ink'],
  ['secondary text', '#a29cb4', '--color-ink-3'],
  ['button background', '#9b7bf5', '--color-accent'],
  ['button text', '#120a2a', '--color-accent-ink'],
  ['radius', '6px', '--radius-md'],
  ['font', 'system-ui, sans-serif', 'no Geist: next/font lives in the layout'],
]
