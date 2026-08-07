// M4: `jest --coverage`'s own 'text' reporter writes straight to stdout,
// which can lose its own output to jest.config.js's forceExit racing the
// (non-TTY) stdout flush — see that file's coverageReporters comment for
// the full "why". This script is the deterministic replacement: it runs as
// its OWN process, started only after `jest --coverage` has already exited
// (see the "test:cov" script in package.json), and reads the
// 'json-summary' reporter's plain, synchronously-written output — so there
// is nothing left to race by the time this file runs.
'use strict'

const fs = require('fs')
const path = require('path')

const SUMMARY_PATH = path.join(
  __dirname,
  '..',
  'coverage',
  'coverage-summary.json',
)
const METRICS = ['statements', 'branches', 'functions', 'lines']
const COLUMN_LABELS = ['File', '% Stmts', '% Branch', '% Funcs', '% Lines']
const COLUMN_WIDTH = 10

function loadSummary() {
  if (!fs.existsSync(SUMMARY_PATH)) {
    console.error(
      `print-coverage-summary: ${SUMMARY_PATH} not found. Did jest run with ` +
        "'json-summary' in coverageReporters (jest.config.js)?",
    )
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf-8'))
}

function pctCell(pct) {
  return `${pct.toFixed(2)}%`.padStart(COLUMN_WIDTH - 1) + ' '
}

function row(label, fileSummary) {
  const cells = METRICS.map(metric => pctCell(fileSummary[metric].pct))
  return `${label.padEnd(40)} ${cells.join('')}`
}

function main() {
  const summary = loadSummary()
  const { total, ...perFile } = summary

  const relativePaths = Object.keys(perFile).sort((a, b) => a.localeCompare(b))

  console.log(
    `${COLUMN_LABELS[0].padEnd(40)} ${COLUMN_LABELS.slice(1)
      .map(label => label.padStart(COLUMN_WIDTH - 1) + ' ')
      .join('')}`,
  )
  console.log(row('All files', total))
  for (const absolutePath of relativePaths) {
    const relativePath = path.relative(path.join(__dirname, '..'), absolutePath)
    console.log(row(relativePath, perFile[absolutePath]))
  }
}

main()
