#!/usr/bin/env node
// Checks the Grafana dashboards under infra/monitoring: `lint` validates the
// JSON offline, `live` runs every panel query against production (read-only).
//
//   node infra/monitoring/scripts/check-dashboards.mjs lint [file.json ...]
//   node infra/monitoring/scripts/check-dashboards.mjs live [--range 24h] [--var name=value ...] [file.json ...]
//
// Node stdlib only. Commands are executed with execFile (no shell), so a query
// containing backticks, quotes or newlines is only ever URL-encoded.

import { execFile } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const DEFAULT_DIR = fileURLToPath(
  new URL('../grafana/provisioning/dashboards/json/', import.meta.url),
)

const PROMETHEUS_CONTAINER = 'lilnas-prometheus-1'
const GRAFANA_CONTAINER = 'lilnas-grafana-1'
const DATASOURCE_UIDS = ['prometheus', 'loki']
const BUILTIN_VARS = ['__rate_interval', '__interval', '__range', '__auto']
const EVENT_DRIVEN_PREFIX = 'Event-driven:'
// Panel types that never carry queries.
const QUERYLESS_TYPES = ['text']

// `$name`, `${name}` and `${name:format}`. Purely numeric names (`$1` in a
// label_replace replacement) and a `$` that ends a regex are not variables.
const VAR_PATTERN = /\$\{(\w+)(?::[^}]*)?\}|\$(\w+)/g

export function variableNames(expr) {
  const names = []
  for (const match of String(expr).matchAll(VAR_PATTERN)) {
    const name = match[1] ?? match[2]
    if (!/^\d+$/.test(name)) names.push(name)
  }
  return names
}

/** Every panel in a dashboard, including those nested in (collapsed) rows. */
export function allPanels(dashboard) {
  const out = []
  const walk = panels => {
    for (const panel of panels ?? []) {
      out.push(panel)
      if (Array.isArray(panel.panels)) walk(panel.panels)
    }
  }
  walk(dashboard.panels)
  return out
}

export const isRow = panel => panel.type === 'row'

const visibleTargets = panel => (panel.targets ?? []).filter(t => !t.hide)

const targetDatasourceUid = (panel, target) =>
  target.datasource?.uid ?? panel.datasource?.uid

// ---------------------------------------------------------------------------
// lint

export function lintDashboards(dashboards) {
  const problems = []
  const uids = new Map()

  for (const { file, json: d } of dashboards) {
    const problem = message => problems.push(`${file}: ${message}`)

    if (typeof d.uid !== 'string' || !d.uid.startsWith('lilnas-')) {
      problem(`uid ${JSON.stringify(d.uid)} must start with "lilnas-"`)
    } else if (uids.has(d.uid)) {
      problem(`uid "${d.uid}" is already used by ${uids.get(d.uid)}`)
    } else {
      uids.set(d.uid, file)
    }
    if (!Array.isArray(d.tags) || !d.tags.includes('lilnas')) {
      problem('tags must contain "lilnas"')
    }
    if (typeof d.title !== 'string' || d.title.length === 0) {
      problem('title is not set')
    }
    if (d.id !== null && d.id !== undefined) {
      problem(
        `top-level id must be null or absent, got ${JSON.stringify(d.id)}`,
      )
    }

    const known = new Set([
      ...BUILTIN_VARS,
      ...(d.templating?.list ?? []).map(v => v.name),
    ])
    const seenIds = new Set()

    for (const panel of allPanels(d)) {
      if (panel.id !== undefined) {
        if (seenIds.has(panel.id)) problem(`panel id ${panel.id} is used twice`)
        seenIds.add(panel.id)
      }
      if (isRow(panel) || QUERYLESS_TYPES.includes(panel.type)) continue

      const where = `panel ${panel.id ?? '?'} "${panel.title ?? ''}"`
      if (typeof panel.title !== 'string' || panel.title.length === 0) {
        problem(`${where}: no title`)
      }

      const targets = panel.targets ?? []
      const uidsInUse = new Set([
        panel.datasource?.uid,
        ...targets.map(t => t.datasource?.uid),
      ])
      uidsInUse.delete(undefined)
      if (uidsInUse.size === 0) {
        problem(`${where}: no datasource uid`)
      }
      for (const uid of uidsInUse) {
        if (!DATASOURCE_UIDS.includes(uid)) {
          problem(
            `${where}: datasource uid ${JSON.stringify(uid)} must be one of ${DATASOURCE_UIDS.join(', ')}`,
          )
        }
      }

      const withExpr = targets.filter(
        t => typeof t.expr === 'string' && t.expr.trim() !== '',
      )
      if (withExpr.length === 0) {
        problem(`${where}: no target with a non-empty expr`)
      }
      for (const target of withExpr) {
        for (const name of new Set(variableNames(target.expr))) {
          if (!known.has(name)) {
            problem(
              `${where}: target ${target.refId ?? '?'} uses $${name}, which is not a dashboard variable`,
            )
          }
        }
      }
    }
  }
  return problems
}

// ---------------------------------------------------------------------------
// command runner (replaceable in tests)

/**
 * Runs a command without a shell and resolves with its stdout.
 * Rejects with an Error whose message is the first line of stderr (or the
 * exec error) so a failing query is reported readably.
 */
export function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { maxBuffer: 256 * 1024 * 1024, timeout: 60_000 },
      (error, stdout, stderr) => {
        if (error) {
          const line = String(stderr).trim().split('\n').filter(Boolean).pop()
          reject(new Error(line || error.message))
        } else {
          resolve(stdout)
        }
      },
    )
  })
}

const q = encodeURIComponent

const promCommand = path => [
  'docker',
  [
    'exec',
    PROMETHEUS_CONTAINER,
    'wget',
    '-qO-',
    `http://localhost:9090${path}`,
  ],
]

const lokiCommand = path => [
  'docker',
  [
    'exec',
    GRAFANA_CONTAINER,
    'wget',
    '-qO-',
    '--header',
    'X-Forwarded-User: admin@local',
    `http://localhost:3000/api/datasources/proxy/uid/loki${path}`,
  ],
]

/** A LogQL metric query starts with a function/aggregation; a log query with a selector. */
export const isLokiMetricQuery = expr => !expr.trimStart().startsWith('{')

async function getJson(run, [cmd, args]) {
  const raw = await run(cmd, args)
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    throw new Error(`non-JSON response: ${String(raw).slice(0, 120)}`)
  }
  if (body.status && body.status !== 'success') {
    throw new Error(body.error || `status ${body.status}`)
  }
  return body
}

/** Number of series (or streams) an expression returns. */
export async function queryExpr(run, uid, expr, range) {
  if (uid === 'prometheus') {
    const body = await getJson(
      run,
      promCommand(`/api/v1/query?query=${q(expr)}`),
    )
    const result = body.data?.result
    if (
      body.data?.resultType === 'scalar' ||
      body.data?.resultType === 'string'
    ) {
      return result ? 1 : 0
    }
    return Array.isArray(result) ? result.length : 0
  }
  if (uid === 'loki') {
    const path = isLokiMetricQuery(expr)
      ? `/loki/api/v1/query?query=${q(expr)}`
      : `/loki/api/v1/query_range?query=${q(expr)}&since=${q(range)}&limit=1`
    const body = await getJson(run, lokiCommand(path))
    const result = body.data?.result
    return Array.isArray(result) ? result.length : 0
  }
  throw new Error(`unsupported datasource uid ${JSON.stringify(uid)}`)
}

// ---------------------------------------------------------------------------
// variables and substitution

/**
 * Replaces built-in and dashboard variables in a single pass, so a value is
 * never rescanned and `$job` cannot clobber `$job_name`. Built-ins win over a
 * dashboard variable of the same name. Throws on an unresolved variable.
 */
export function substitute(expr, values, range) {
  const builtins = {
    __rate_interval: '5m',
    __interval: '5m',
    __auto: '5m',
    __range: range,
  }
  return expr.replace(VAR_PATTERN, (whole, braced, bare) => {
    const name = braced ?? bare
    if (/^\d+$/.test(name)) return whole
    if (Object.hasOwn(builtins, name)) return builtins[name]
    if (Object.hasOwn(values, name)) return values[name]
    throw new Error(`unresolved variable $${name}`)
  })
}

/** Parses `label_values(label)` / `label_values(selector, label)`. */
export function parseLabelValues(query) {
  const m = /^\s*label_values\(([\s\S]*)\)\s*$/.exec(query)
  if (!m) return null
  const inner = m[1]
  const comma = inner.lastIndexOf(',')
  if (comma === -1) return { label: inner.trim(), match: null }
  return {
    match: inner.slice(0, comma).trim(),
    label: inner.slice(comma + 1).trim(),
  }
}

async function queryVariableValues(run, variable, queryText, range) {
  const parsed = parseLabelValues(queryText)
  if (!parsed) throw new Error(`unsupported variable query: ${queryText}`)
  const uid = variable.datasource?.uid
  let command
  if (uid === 'prometheus') {
    const match = parsed.match ? `?match[]=${q(parsed.match)}` : ''
    command = promCommand(`/api/v1/label/${q(parsed.label)}/values${match}`)
  } else if (uid === 'loki') {
    const query = parsed.match ? `&query=${q(parsed.match)}` : ''
    command = lokiCommand(
      `/loki/api/v1/label/${q(parsed.label)}/values?since=${q(range)}${query}`,
    )
  } else {
    throw new Error(`unsupported variable datasource ${JSON.stringify(uid)}`)
  }
  const body = await getJson(run, command)
  return Array.isArray(body.data) ? body.data : []
}

const joinValue = v => (Array.isArray(v) ? v.join('|') : String(v))

/**
 * Resolves every templating variable of a dashboard. Returns the substitution
 * values plus one report per query variable (its own live check).
 * Precedence: --var, current.value, first query value, `.*` for a textbox.
 */
async function resolveVariables(run, dashboard, overrides, range) {
  const values = {}
  const reports = []

  for (const variable of dashboard.templating?.list ?? []) {
    const { name } = variable
    let queried
    if (variable.type === 'query') {
      const label = `variable ${name}`
      try {
        const queryText = substitute(
          String(variable.query?.query ?? variable.query ?? ''),
          values,
          range,
        )
        queried = await queryVariableValues(run, variable, queryText, range)
        reports.push(
          queried.length > 0
            ? { label, status: 'OK', detail: `${queried.length} values` }
            : { label, status: 'EMPTY' },
        )
      } catch (error) {
        reports.push({ label, status: 'ERROR', detail: error.message })
      }
    }

    if (Object.hasOwn(overrides, name)) {
      values[name] = overrides[name]
      continue
    }
    const current = variable.current?.value
    if (current !== undefined && current !== null) {
      const isAll =
        current === '$__all' ||
        (Array.isArray(current) && current.includes('$__all'))
      if (isAll) {
        values[name] = variable.allValue ?? '.*'
      } else {
        values[name] = joinValue(current)
      }
      continue
    }
    if (variable.type === 'query') {
      if (queried?.length) values[name] = String(queried[0])
    } else if (variable.type === 'textbox') {
      values[name] = '.*'
    } else if (variable.type === 'constant') {
      values[name] = String(variable.query ?? '')
    } else if (variable.type === 'custom') {
      const first = String(variable.query ?? '')
        .split(',')[0]
        .trim()
      if (first) values[name] = first
    }
  }
  return { values, reports }
}

// ---------------------------------------------------------------------------
// live

/**
 * Runs every variable and panel target of the dashboards.
 * Returns the output lines and whether everything passed.
 */
export async function checkLive(
  dashboards,
  { run = runCommand, range = '24h', vars = {} } = {},
) {
  const lines = []
  const summaries = []
  let ok = true

  for (const { file, json: d } of dashboards) {
    const counts = { OK: 0, EMPTY: 0, 'EMPTY (event-driven)': 0, ERROR: 0 }
    const say = (status, text, ...extra) => {
      counts[status] += 1
      lines.push(`${text}`)
      for (const line of extra) lines.push(`    ${line}`)
    }

    const row = (status, name) => `  ${status.padEnd(18)} ${name}`
    lines.push(`${d.uid ?? file} (${path.basename(file)})`)
    const { values, reports } = await resolveVariables(run, d, vars, range)
    for (const r of reports) {
      const status = r.status === 'OK' ? 'OK' : r.status
      say(status, row(r.detail ? `${status} ${r.detail}` : status, r.label))
    }

    for (const panel of allPanels(d)) {
      if (isRow(panel) || QUERYLESS_TYPES.includes(panel.type)) continue
      const name = `#${panel.id ?? '?'} ${panel.title ?? ''}`
      const targets = visibleTargets(panel).filter(
        t => typeof t.expr === 'string' && t.expr.trim() !== '',
      )
      if (targets.length === 0) {
        say('ERROR', row('ERROR no runnable targets', name))
        continue
      }

      let series = 0
      const empties = []
      const errors = []
      for (const target of targets) {
        const label = target.refId ?? '?'
        try {
          const expr = substitute(target.expr, values, range)
          const n = await queryExpr(
            run,
            targetDatasourceUid(panel, target),
            expr,
            range,
          )
          if (n === 0) empties.push(`target ${label} empty: ${target.expr}`)
          series += n
        } catch (error) {
          errors.push(`target ${label} error: ${error.message}`)
        }
      }

      const detail = [
        ...errors,
        ...(series > 0 && empties.length === 0 ? [] : empties),
      ]
      if (errors.length > 0 && series === 0) {
        const message = errors[0].replace(/^target \S+ error: /, '')
        say('ERROR', row(`ERROR ${message}`, name), ...detail)
      } else if (series > 0) {
        say('OK', row(`OK ${series} series`, name), ...detail)
      } else if (
        String(panel.description ?? '').startsWith(EVENT_DRIVEN_PREFIX)
      ) {
        say(
          'EMPTY (event-driven)',
          row('EMPTY (event-driven)', name),
          ...detail,
        )
      } else {
        say('EMPTY', row('EMPTY', name), ...detail)
      }
    }

    if (counts.ERROR > 0 || counts.EMPTY > 0) ok = false
    summaries.push(
      `${d.uid ?? file}: ${counts.OK} OK, ${counts.EMPTY} EMPTY, ${counts['EMPTY (event-driven)']} EMPTY (event-driven), ${counts.ERROR} ERROR`,
    )
  }

  lines.push('', 'Summary', ...summaries.map(s => `  ${s}`))
  return { lines, ok }
}

// ---------------------------------------------------------------------------
// cli

function loadDashboards(files) {
  const list =
    files.length > 0
      ? files
      : readdirSync(DEFAULT_DIR)
          .filter(f => f.endsWith('.json'))
          .sort()
          .map(f => path.join(DEFAULT_DIR, f))
  const dashboards = []
  const problems = []
  for (const file of list) {
    try {
      dashboards.push({ file, json: JSON.parse(readFileSync(file, 'utf8')) })
    } catch (error) {
      problems.push(`${file}: cannot read as JSON: ${error.message}`)
    }
  }
  return { dashboards, problems }
}

const USAGE = `usage:
  check-dashboards.mjs lint [file.json ...]
  check-dashboards.mjs live [--range 24h] [--var name=value ...] [file.json ...]`

export function parseArgs(argv) {
  const [mode, ...rest] = argv
  const opts = { mode, range: '24h', vars: {}, files: [] }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    const take = flag => {
      if (arg === flag) return rest[++i]
      if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1)
      return undefined
    }
    if (arg === '--range' || arg.startsWith('--range=')) {
      opts.range = take('--range')
    } else if (arg === '--var' || arg.startsWith('--var=')) {
      const pair = take('--var') ?? ''
      const eq = pair.indexOf('=')
      if (eq < 1) throw new Error(`--var expects name=value, got "${pair}"`)
      opts.vars[pair.slice(0, eq)] = pair.slice(eq + 1)
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option ${arg}`)
    } else {
      opts.files.push(arg)
    }
  }
  if (!opts.range) throw new Error('--range needs a value')
  return opts
}

export async function main(
  argv,
  { run = runCommand, out = console.log, err = console.error } = {},
) {
  let opts
  try {
    opts = parseArgs(argv)
    if (opts.mode !== 'lint' && opts.mode !== 'live')
      throw new Error('mode must be lint or live')
  } catch (error) {
    err(`${error.message}\n${USAGE}`)
    return 2
  }

  const { dashboards, problems: readProblems } = loadDashboards(opts.files)

  if (opts.mode === 'lint') {
    const problems = [...readProblems, ...lintDashboards(dashboards)]
    for (const p of problems) out(p)
    if (problems.length === 0) out(`lint ok: ${dashboards.length} dashboards`)
    return problems.length > 0 ? 1 : 0
  }

  for (const p of readProblems) out(p)
  const { lines, ok } = await checkLive(dashboards, {
    run,
    range: opts.range,
    vars: opts.vars,
  })
  for (const line of lines) out(line)
  return ok && readProblems.length === 0 ? 0 : 1
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main(process.argv.slice(2))
}
