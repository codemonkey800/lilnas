import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { after, describe, test } from 'node:test'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  checkLive,
  isLokiMetricQuery,
  lintDashboards,
  main,
  parseLabelValues,
  substitute,
  variableNames,
} from './check-dashboards.mjs'

// ---------------------------------------------------------------------------
// fixtures

const prom = { type: 'prometheus', uid: 'prometheus' }
const loki = { type: 'loki', uid: 'loki' }

const panel = (id, extra = {}) => ({
  id,
  type: 'stat',
  title: `Panel ${id}`,
  datasource: prom,
  targets: [{ refId: 'A', expr: `metric_${id}` }],
  ...extra,
})

const dashboard = (extra = {}) => ({
  id: null,
  uid: 'lilnas-fixture',
  title: 'Fixture',
  tags: ['lilnas'],
  templating: { list: [] },
  panels: [panel(1)],
  ...extra,
})

const lint = (...dashboards) =>
  lintDashboards(dashboards.map((json, i) => ({ file: `d${i}.json`, json })))

const live = (json, options) =>
  checkLive([{ file: 'fixture.json', json }], options)

/**
 * A fake command runner. `handle({ kind, path, query, params })` returns the
 * data for a request: an array (result list / label values) or throws.
 */
function fakeRunner(handle) {
  const calls = []
  const run = async (cmd, args) => {
    assert.equal(cmd, 'docker')
    const url = new URL(args.at(-1))
    const kind = args[1] === 'lilnas-prometheus-1' ? 'prom' : 'loki'
    const request = {
      kind,
      path: url.pathname.replace('/api/datasources/proxy/uid/loki', ''),
      query: url.searchParams.get('query'),
      params: url.searchParams,
      args,
    }
    calls.push(request)
    const data = handle(request)
    const isValues = request.path.includes('/label/')
    return JSON.stringify({
      status: 'success',
      data: isValues ? data : { resultType: 'vector', result: data },
    })
  }
  return { run, calls }
}

const series = n => Array.from({ length: n }, (_, i) => ({ metric: { i } }))

// ---------------------------------------------------------------------------
// lint

describe('lint: uid, tags, title, id', () => {
  test('accepts a well formed dashboard', () => {
    assert.deepEqual(lint(dashboard()), [])
  })

  test('uid must start with lilnas-', () => {
    assert.match(lint(dashboard({ uid: 'storage' }))[0], /uid .*lilnas-/)
    assert.match(lint(dashboard({ uid: undefined }))[0], /uid/)
  })

  test('uid must be unique across files', () => {
    assert.deepEqual(
      lint(dashboard({ uid: 'lilnas-a' }), dashboard({ uid: 'lilnas-b' })),
      [],
    )
    const problems = lint(dashboard(), dashboard())
    assert.equal(problems.length, 1)
    assert.match(
      problems[0],
      /d1\.json: uid "lilnas-fixture" is already used by d0\.json/,
    )
  })

  test('tags must contain lilnas', () => {
    assert.match(lint(dashboard({ tags: ['storage'] }))[0], /tags/)
    assert.match(lint(dashboard({ tags: undefined }))[0], /tags/)
  })

  test('title must be set', () => {
    assert.match(lint(dashboard({ title: '' }))[0], /title/)
  })

  test('top-level id must be null or absent', () => {
    assert.deepEqual(lint(dashboard({ id: undefined })), [])
    assert.match(lint(dashboard({ id: 7 }))[0], /top-level id/)
  })
})

describe('lint: panels', () => {
  test('panel ids must be unique', () => {
    assert.match(
      lint(dashboard({ panels: [panel(1), panel(1)] }))[0],
      /panel id 1 is used twice/,
    )
  })

  test('panel ids are unique across rows, including collapsed rows', () => {
    const row = {
      id: 10,
      type: 'row',
      title: 'Row',
      collapsed: true,
      panels: [panel(2), panel(3)],
    }
    assert.deepEqual(lint(dashboard({ panels: [panel(1), row] })), [])
    const clash = { ...row, panels: [panel(1)] }
    assert.match(
      lint(dashboard({ panels: [panel(1), clash] }))[0],
      /panel id 1 is used twice/,
    )
  })

  test('panels nested in a collapsed row are linted', () => {
    const bad = panel(2, { title: '' })
    const row = {
      id: 10,
      type: 'row',
      title: 'Row',
      collapsed: true,
      panels: [bad],
    }
    assert.match(lint(dashboard({ panels: [row] }))[0], /no title/)
  })

  test('a row needs no title, datasource or targets', () => {
    assert.deepEqual(
      lint(dashboard({ panels: [{ id: 5, type: 'row', panels: [] }] })),
      [],
    )
  })

  test('a panel needs a title', () => {
    assert.match(
      lint(dashboard({ panels: [panel(1, { title: undefined })] }))[0],
      /no title/,
    )
  })

  test('datasource uid must be prometheus or loki', () => {
    assert.deepEqual(
      lint(dashboard({ panels: [panel(1, { datasource: loki })] })),
      [],
    )
    const bad = lint(
      dashboard({ panels: [panel(1, { datasource: { uid: 'mysql' } })] }),
    )
    assert.match(bad[0], /datasource uid "mysql"/)
    assert.match(
      lint(dashboard({ panels: [panel(1, { datasource: undefined })] }))[0],
      /no datasource uid/,
    )
  })

  test('a datasource set only on the targets is accepted', () => {
    const p = panel(1, {
      datasource: undefined,
      targets: [{ refId: 'A', expr: 'up', datasource: prom }],
    })
    assert.deepEqual(lint(dashboard({ panels: [p] })), [])
  })

  test('a panel needs a target with a non-empty expr', () => {
    assert.match(
      lint(dashboard({ panels: [panel(1, { targets: [] })] }))[0],
      /non-empty expr/,
    )
    assert.match(
      lint(
        dashboard({
          panels: [panel(1, { targets: [{ refId: 'A', expr: '  ' }] })],
        }),
      )[0],
      /non-empty expr/,
    )
    const mixed = panel(1, {
      targets: [{ refId: 'A' }, { refId: 'B', expr: 'up' }],
    })
    assert.deepEqual(lint(dashboard({ panels: [mixed] })), [])
  })

  test('text panels need no queries', () => {
    const text = {
      id: 9,
      type: 'text',
      title: 'Notes',
      options: { content: 'hi' },
    }
    assert.deepEqual(lint(dashboard({ panels: [text] })), [])
  })
})

describe('lint: variables in expr', () => {
  const withExpr = (expr, list = []) =>
    dashboard({
      templating: { list },
      panels: [panel(1, { targets: [{ refId: 'A', expr }] })],
    })

  test('built-ins are always allowed', () => {
    const expr =
      'rate(x[$__rate_interval]) + rate(y[${__interval}]) + z[$__range] + w[$__auto]'
    assert.deepEqual(lint(withExpr(expr)), [])
  })

  test('declared variables are allowed in both syntaxes', () => {
    const list = [{ name: 'job', type: 'query' }]
    assert.deepEqual(
      lint(
        withExpr(
          'up{job="$job"} + up{job=~"${job}"} + up{job=~"${job:regex}"}',
          list,
        ),
      ),
      [],
    )
  })

  test('an undeclared variable is reported', () => {
    const problems = lint(withExpr('up{job="$job"}'))
    assert.equal(problems.length, 1)
    assert.match(problems[0], /uses \$job, which is not a dashboard variable/)
    assert.match(lint(withExpr('up{job="${job}"}'))[0], /\$job/)
  })

  test('a regex end anchor and $1 are not variables', () => {
    assert.deepEqual(
      variableNames('up{job=~"a$"} label_replace(x, "a", "$1", "b", "(.*)")'),
      [],
    )
    assert.deepEqual(lint(withExpr('up{job=~"a$|b$"}')), [])
  })
})

// ---------------------------------------------------------------------------
// substitution

describe('substitute', () => {
  const values = { job: 'equations', job_name: 'long', __range: 'hijack' }

  test('built-in intervals become 5m and $__range the given range', () => {
    assert.equal(
      substitute(
        'rate(x[$__rate_interval]) y[${__interval}] z[$__auto] w[$__range]',
        {},
        '7d',
      ),
      'rate(x[5m]) y[5m] z[5m] w[7d]',
    )
  })

  test('built-ins win over a dashboard variable of the same name', () => {
    assert.equal(substitute('[$__range]', values, '24h'), '[24h]')
  })

  test('a longer variable name is not clobbered by a shorter prefix', () => {
    assert.equal(
      substitute('$job_name $job ${job}', values, '24h'),
      'long equations equations',
    )
  })

  test('substituted values are not scanned again', () => {
    assert.equal(substitute('$a $b', { a: '$b', b: 'x' }, '24h'), '$b x')
  })

  test('a format specifier is ignored and $1 is kept', () => {
    assert.equal(
      substitute('${job:regex} "$1"', values, '24h'),
      'equations "$1"',
    )
  })

  test('an unresolved variable throws', () => {
    assert.throws(
      () => substitute('up{job="$nope"}', values, '24h'),
      /unresolved variable \$nope/,
    )
  })
})

describe('label_values and the Loki query kind', () => {
  test('parses label_values forms', () => {
    assert.deepEqual(parseLabelValues('label_values(service)'), {
      label: 'service',
      match: null,
    })
    assert.deepEqual(
      parseLabelValues('label_values(http_requests_total{a="b,c"}, job)'),
      {
        match: 'http_requests_total{a="b,c"}',
        label: 'job',
      },
    )
    assert.equal(parseLabelValues('up'), null)
  })

  test('a selector is a log query, anything else a metric query', () => {
    assert.equal(isLokiMetricQuery('{service="x"} |= `a`'), false)
    assert.equal(
      isLokiMetricQuery('sum(count_over_time({service="x"}[1m]))'),
      true,
    )
    assert.equal(isLokiMetricQuery('count_over_time({service="x"}[1m])'), true)
    assert.equal(
      isLokiMetricQuery('  sum by (service) (rate({service="x"}[1m]))'),
      true,
    )
  })
})

// ---------------------------------------------------------------------------
// live

describe('live: statuses', () => {
  test('OK reports the series count and EMPTY is a failure', async () => {
    const d = dashboard({ panels: [panel(1), panel(2)] })
    const { run } = fakeRunner(r => (r.query === 'metric_1' ? series(3) : []))
    const { lines, ok } = await live(d, { run })
    assert.match(lines.join('\n'), /OK 3 series\s+#1 Panel 1/)
    assert.match(lines.join('\n'), /EMPTY\s+#2 Panel 2/)
    assert.equal(ok, false)
    assert.match(
      lines.at(-1),
      /lilnas-fixture: 1 OK, 1 EMPTY, 0 EMPTY \(event-driven\), 0 ERROR/,
    )
  })

  test('an Event-driven: description turns EMPTY into a pass', async () => {
    const d = dashboard({
      panels: [
        panel(1, { description: 'Event-driven: appears when a job runs.' }),
      ],
    })
    const { run } = fakeRunner(() => [])
    const { lines, ok } = await live(d, { run })
    assert.match(lines.join('\n'), /EMPTY \(event-driven\)\s+#1 Panel 1/)
    assert.equal(ok, true)
  })

  test('a description that merely mentions event-driven stays a plain EMPTY', async () => {
    const d = dashboard({
      panels: [panel(1, { description: 'Shows event-driven data' })],
    })
    const { run } = fakeRunner(() => [])
    const { ok, lines } = await live(d, { run })
    assert.equal(ok, false)
    assert.doesNotMatch(lines.join('\n'), /EMPTY \(event-driven\)\s+#1/)
  })

  test('a failing query is ERROR with its message and fails the run', async () => {
    const run = async () => {
      throw new Error('wget: server returned error: HTTP/1.1 400 Bad Request')
    }
    const { lines, ok } = await live(dashboard(), { run })
    assert.match(
      lines.join('\n'),
      /ERROR wget: server returned error: HTTP\/1.1 400 Bad Request\s+#1 Panel 1/,
    )
    assert.equal(ok, false)
    assert.match(lines.at(-1), /1 ERROR/)
  })

  test('an unresolved variable is ERROR and runs no query', async () => {
    const d = dashboard({
      panels: [
        panel(1, { targets: [{ refId: 'A', expr: 'up{job="$nope"}' }] }),
      ],
    })
    const { run, calls } = fakeRunner(() => series(1))
    const { lines, ok } = await live(d, { run })
    assert.match(lines.join('\n'), /ERROR unresolved variable \$nope/)
    assert.equal(ok, false)
    assert.equal(calls.length, 0)
  })

  test('a non-JSON response is ERROR', async () => {
    const { lines } = await live(dashboard(), { run: async () => '<html>' })
    assert.match(lines.join('\n'), /ERROR non-JSON response/)
  })
})

describe('live: targets', () => {
  const multi = (...targets) => dashboard({ panels: [panel(1, { targets })] })

  test('the panel is OK if any target has data and each empty target is listed', async () => {
    const d = multi(
      { refId: 'A', expr: 'has_data' },
      { refId: 'B', expr: 'no_data_b' },
      { refId: 'C', expr: 'no_data_c' },
    )
    const { run } = fakeRunner(r => (r.query === 'has_data' ? series(2) : []))
    const { lines, ok } = await live(d, { run })
    const text = lines.join('\n')
    assert.match(text, /OK 2 series/)
    assert.match(text, /target B empty: no_data_b/)
    assert.match(text, /target C empty: no_data_c/)
    assert.doesNotMatch(text, /target A empty/)
    assert.equal(ok, true)
  })

  test('a fully empty panel lists every target', async () => {
    const d = multi({ refId: 'A', expr: 'a' }, { refId: 'B', expr: 'b' })
    const { run } = fakeRunner(() => [])
    const { lines } = await live(d, { run })
    assert.match(lines.join('\n'), /target A empty: a\n.*target B empty: b/)
  })

  test('an erroring target next to one with data makes the panel ERROR and fails the run', async () => {
    const d = multi({ refId: 'A', expr: 'good' }, { refId: 'B', expr: 'bad' })
    const run = async (cmd, args) => {
      if (decodeURIComponent(args.at(-1)).includes('query=bad'))
        throw new Error('parse error')
      return JSON.stringify({
        status: 'success',
        data: { resultType: 'vector', result: series(1) },
      })
    }
    const { lines, ok } = await live(d, { run })
    const text = lines.join('\n')
    assert.match(text, /ERROR parse error\s+#1 Panel 1/)
    assert.doesNotMatch(text, /OK 1 series/)
    assert.match(text, /target B error: parse error/)
    assert.equal(ok, false)
    assert.match(
      lines.at(-1),
      /0 OK, 0 EMPTY, 0 EMPTY \(event-driven\), 1 ERROR/,
    )
  })

  test('a hidden target is skipped', async () => {
    const d = multi(
      { refId: 'A', expr: 'shown' },
      { refId: 'B', expr: 'hidden', hide: true },
    )
    const { run, calls } = fakeRunner(() => series(1))
    await live(d, { run })
    assert.deepEqual(
      calls.map(c => c.query),
      ['shown'],
    )
  })

  test('a panel whose targets are all hidden is an ERROR', async () => {
    const d = multi({ refId: 'A', expr: 'hidden', hide: true })
    const { run } = fakeRunner(() => series(1))
    const { lines, ok } = await live(d, { run })
    assert.match(lines.join('\n'), /ERROR no runnable targets/)
    assert.equal(ok, false)
  })

  test('panels nested in a collapsed row are queried; rows are not', async () => {
    const row = {
      id: 10,
      type: 'row',
      title: 'Row',
      collapsed: true,
      panels: [panel(2), panel(3)],
    }
    const d = dashboard({ panels: [panel(1), row] })
    const { run, calls } = fakeRunner(() => series(1))
    const { lines } = await live(d, { run })
    assert.deepEqual(
      calls.map(c => c.query),
      ['metric_1', 'metric_2', 'metric_3'],
    )
    assert.match(lines.at(-1), /3 OK/)
  })

  test('expr with backticks, quotes and newlines is URL-encoded, never shell-quoted', async () => {
    const expr = 'sum(rate({service="a\'b"} |= `x $(whoami)`\n[1m]))'
    const d = dashboard({
      panels: [panel(1, { datasource: loki, targets: [{ refId: 'A', expr }] })],
    })
    const { run, calls } = fakeRunner(() => series(1))
    await live(d, { run })
    assert.equal(calls[0].query, expr)
    const url = calls[0].args.at(-1)
    assert.doesNotMatch(url, /[`"\n ]/)
    assert.ok(calls[0].args.every(a => typeof a === 'string'))
  })
})

describe('live: datasources', () => {
  test('Prometheus goes through docker exec on the prometheus container', async () => {
    const { run, calls } = fakeRunner(() => series(1))
    await live(dashboard(), { run })
    assert.deepEqual(calls[0].args.slice(0, 4), [
      'exec',
      'lilnas-prometheus-1',
      'wget',
      '-qO-',
    ])
    assert.equal(calls[0].path, '/api/v1/query')
  })

  test('a Loki metric query uses /query', async () => {
    const d = dashboard({
      panels: [
        panel(1, {
          datasource: loki,
          targets: [
            { refId: 'A', expr: 'sum(count_over_time({service="x"} [1m]))' },
          ],
        }),
      ],
    })
    const { run, calls } = fakeRunner(() => series(1))
    await live(d, { run })
    assert.equal(calls[0].kind, 'loki')
    assert.equal(calls[0].path, '/loki/api/v1/query')
    assert.ok(calls[0].args.includes('X-Forwarded-User: admin@local'))
  })

  test('a Loki log query uses query_range with limit=1 and since=<range>', async () => {
    const d = dashboard({
      panels: [
        panel(1, {
          datasource: loki,
          targets: [{ refId: 'A', expr: '{service="x"}' }],
        }),
      ],
    })
    const { run, calls } = fakeRunner(() => series(1))
    await live(d, { run, range: '6h' })
    assert.equal(calls[0].path, '/loki/api/v1/query_range')
    assert.equal(calls[0].params.get('limit'), '1')
    assert.equal(calls[0].params.get('since'), '6h')
  })

  test('a target datasource overrides the panel datasource', async () => {
    const d = dashboard({
      panels: [
        panel(1, {
          targets: [{ refId: 'A', expr: '{service="x"}', datasource: loki }],
        }),
      ],
    })
    const { run, calls } = fakeRunner(() => series(1))
    await live(d, { run })
    assert.equal(calls[0].kind, 'loki')
  })
})

describe('live: variable resolution order', () => {
  const textbox = (extra = {}) => ({ name: 'v', type: 'textbox', ...extra })
  const queryVar = (extra = {}) => ({
    name: 'v',
    type: 'query',
    datasource: prom,
    query: 'label_values(up, job)',
    ...extra,
  })
  const using = list =>
    dashboard({
      templating: { list },
      panels: [panel(1, { targets: [{ refId: 'A', expr: 'up{job="$v"}' }] })],
    })
  const exprs = calls =>
    calls.filter(c => c.path === '/api/v1/query').map(c => c.query)
  const handler = r =>
    r.path.includes('/label/') ? ['first', 'second'] : series(1)

  test('--var beats current.value, which beats the first query value', async () => {
    const list = [queryVar({ current: { value: 'cur' } })]
    let f = fakeRunner(handler)
    await live(using(list), { run: f.run, vars: { v: 'cli' } })
    assert.deepEqual(exprs(f.calls), ['up{job="cli"}'])

    f = fakeRunner(handler)
    await live(using(list), { run: f.run })
    assert.deepEqual(exprs(f.calls), ['up{job="cur"}'])

    f = fakeRunner(handler)
    await live(using([queryVar({ current: {} })]), { run: f.run })
    assert.deepEqual(exprs(f.calls), ['up{job="first"}'])
  })

  test('the variable query itself is run and an empty one is EMPTY', async () => {
    const f = fakeRunner(r => (r.path.includes('/label/') ? [] : series(1)))
    const { lines, ok } = await live(
      using([queryVar({ current: { value: 'cur' } })]),
      { run: f.run },
    )
    assert.equal(f.calls[0].path, '/api/v1/label/job/values')
    assert.equal(f.calls[0].params.get('match[]'), 'up')
    assert.match(lines.join('\n'), /EMPTY\s+variable v/)
    assert.equal(ok, false)
  })

  test('a textbox falls back to .* without a current value, and uses it when set', async () => {
    let f = fakeRunner(handler)
    await live(using([textbox()]), { run: f.run })
    assert.deepEqual(exprs(f.calls), ['up{job=".*"}'])

    f = fakeRunner(handler)
    await live(using([textbox({ current: { value: 'abc' } })]), { run: f.run })
    assert.deepEqual(exprs(f.calls), ['up{job="abc"}'])
  })

  test('$__all becomes allValue, or .* without one', async () => {
    let f = fakeRunner(handler)
    await live(
      using([queryVar({ allValue: '.+', current: { value: '$__all' } })]),
      { run: f.run },
    )
    assert.deepEqual(exprs(f.calls), ['up{job=".+"}'])

    f = fakeRunner(handler)
    await live(using([queryVar({ current: { value: ['$__all'] } })]), {
      run: f.run,
    })
    assert.deepEqual(exprs(f.calls), ['up{job=".*"}'])
  })

  test('a query variable with no value and an empty query leaves the variable unresolved', async () => {
    const f = fakeRunner(r => (r.path.includes('/label/') ? [] : series(1)))
    const { lines } = await live(using([queryVar({ current: {} })]), {
      run: f.run,
    })
    assert.match(lines.join('\n'), /ERROR unresolved variable \$v/)
  })

  test('a Loki query variable goes through the Grafana proxy', async () => {
    const list = [
      {
        name: 'v',
        type: 'query',
        datasource: loki,
        query: 'label_values(service)',
      },
    ]
    const f = fakeRunner(handler)
    await live(using(list), { run: f.run, range: '3h' })
    assert.equal(f.calls[0].kind, 'loki')
    assert.equal(f.calls[0].path, '/loki/api/v1/label/service/values')
    assert.equal(f.calls[0].params.get('since'), '3h')
  })

  test('a later variable query can use an earlier variable', async () => {
    const list = [
      textbox({ name: 'a', current: { value: 'up' } }),
      queryVar({ name: 'v', query: 'label_values($a, job)' }),
    ]
    const f = fakeRunner(handler)
    await live(using(list), { run: f.run })
    assert.equal(f.calls[0].params.get('match[]'), 'up')
  })

  test('$__range is substituted from --range', async () => {
    const d = dashboard({
      panels: [
        panel(1, { targets: [{ refId: 'A', expr: 'increase(x[$__range])' }] }),
      ],
    })
    const f = fakeRunner(() => series(1))
    await live(d, { run: f.run, range: '7d' })
    assert.deepEqual(exprs(f.calls), ['increase(x[7d])'])
  })
})

// ---------------------------------------------------------------------------
// cli and exit codes

describe('main', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-dashboards-'))
  after(() => rmSync(dir, { recursive: true, force: true }))

  const write = (name, json) => {
    const file = path.join(dir, name)
    writeFileSync(file, typeof json === 'string' ? json : JSON.stringify(json))
    return file
  }
  const run = async (argv, runner = fakeRunner(() => series(1)).run) => {
    const out = []
    const err = []
    const code = await main(argv, {
      run: runner,
      out: l => out.push(l),
      err: l => err.push(l),
    })
    return { code, out: out.join('\n'), err: err.join('\n') }
  }

  const good = write('good.json', dashboard())
  const bad = write('bad.json', dashboard({ uid: 'nope', title: '' }))

  test('lint exits 0 on a clean file and 1 with one line per problem', async () => {
    assert.equal((await run(['lint', good])).code, 0)
    const result = await run(['lint', bad])
    assert.equal(result.code, 1)
    assert.equal(result.out.split('\n').length, 2)
    assert.match(result.out, /bad\.json: uid/)
    assert.match(result.out, /bad\.json: title/)
  })

  test('lint reports unreadable JSON and exits 1', async () => {
    const broken = write('broken.json', '{ nope')
    const result = await run(['lint', broken])
    assert.equal(result.code, 1)
    assert.match(result.out, /broken\.json: cannot read as JSON/)
  })

  test('lint without files reads the 9 dashboards in the repo', async () => {
    const result = await run(['lint'])
    assert.equal(result.code, 0, result.out)
    assert.match(result.out, /lint ok: \d+ dashboards/)
  })

  test('live exits 0 when every panel has data, 1 on EMPTY or ERROR', async () => {
    assert.equal((await run(['live', good])).code, 0)
    assert.equal((await run(['live', good], fakeRunner(() => []).run)).code, 1)
    const failing = async () => {
      throw new Error('boom')
    }
    assert.equal((await run(['live', good], failing)).code, 1)
  })

  test('live exits 0 for an event-driven empty panel', async () => {
    const file = write(
      'event.json',
      dashboard({
        panels: [panel(1, { description: 'Event-driven: needs a job.' })],
      }),
    )
    assert.equal((await run(['live', file], fakeRunner(() => []).run)).code, 0)
  })

  test('--range and --var are passed through', async () => {
    const file = write(
      'vars.json',
      dashboard({
        templating: { list: [{ name: 'job', type: 'textbox' }] },
        panels: [
          panel(1, {
            targets: [{ refId: 'A', expr: 'up{job="$job"}[$__range]' }],
          }),
        ],
      }),
    )
    const f = fakeRunner(() => series(1))
    const result = await run(
      ['live', '--range', '7d', '--var', 'job=equations', file],
      f.run,
    )
    assert.equal(result.code, 0)
    assert.equal(f.calls[0].query, 'up{job="equations"}[7d]')
  })

  test('usage errors exit 2', async () => {
    assert.equal((await run([])).code, 2)
    assert.equal((await run(['frobnicate'])).code, 2)
    assert.equal((await run(['live', '--var', 'novalue'])).code, 2)
    assert.equal((await run(['live', '--bogus'])).code, 2)
  })
})

// ---------------------------------------------------------------------------
// security.json: probe panels match the request path, not the whole log line

describe('security dashboard: scanner probe panels', () => {
  const securityFile = new URL(
    '../grafana/provisioning/dashboards/json/security.json',
    import.meta.url,
  )
  const security = JSON.parse(readFileSync(securityFile, 'utf8'))
  const probePanels = security.panels.filter(p => /probe/i.test(p.title ?? ''))

  // A LogQL label filter regex is fully anchored; (?i) becomes the i flag.
  const pathMatcher = expr => {
    const m = /\| RequestPath =~ "((?:[^"\\]|\\.)*)"/.exec(expr)
    if (!m) return null
    const source = JSON.parse(`"${m[1]}"`).replace(/^\(\?i\)/, '')
    return new RegExp(`^(?:${source})$`, 'i')
  }

  test('there are four probe panels (ids 22-25)', () => {
    assert.deepEqual(
      probePanels.map(p => p.id),
      [22, 23, 24, 25],
    )
  })

  test('every probe query filters on the RequestPath field', () => {
    for (const p of probePanels) {
      for (const t of p.targets) {
        assert.ok(
          pathMatcher(t.expr),
          `panel ${p.id} (${p.title}) has no | RequestPath =~ filter: ${t.expr}`,
        )
        // the JSON field must be parsed before it can be filtered on
        assert.ok(
          t.expr.indexOf('| json') < t.expr.indexOf('| RequestPath'),
          `panel ${p.id} filters RequestPath before | json`,
        )
      }
    }
  })

  test('the path filter matches real probes', () => {
    const re = pathMatcher(probePanels[0].targets[0].expr)
    for (const p of [
      '/.env',
      '/.env.production',
      '/.gemini/.env',
      '/.git/config',
      '/.aws/credentials',
      '/wp-login.php',
      '/phpmyadmin/index.php',
      '/@fs/etc/passwd',
      '/.env?x=1',
    ]) {
      assert.ok(re.test(p), `${p} should match`)
    }
  })

  test('own nexus-code and SABnzbd traffic is not a probe', () => {
    const re = pathMatcher(probePanels[0].targets[0].expr)
    const nexus =
      '/trpc/fs.readFile,review.gitStatus,repo.info?batch=1&input=%7B%220%22%3A%7B%22path%22%3A%22%2Fhome%2Fjeremy%2F.nexus-code%2Fworktrees%2F.git%2F.env%22%7D%7D'
    for (const p of [
      nexus,
      '/trpc/review.gitStatus?batch=1',
      '/api?mode=queue&name=.git',
      '/.github/workflows/ci.yml',
    ]) {
      assert.ok(!re.test(p), `${p} should not match`)
    }
  })

  test('own nexus-code Vite /@fs/ assets are excluded from every probe panel', () => {
    for (const p of probePanels) {
      for (const t of p.targets) {
        assert.ok(
          t.expr.includes(
            '| RouterName !~ "nexus-code(-work)?@docker" or RequestPath !~ "[^?]*/@fs/.*"',
          ),
          `panel ${p.id} does not exclude nexus-code /@fs/ assets`,
        )
      }
    }
  })

  test('the no-error panels leave out dashcam and SABnzbd login redirects', () => {
    for (const p of probePanels.filter(p => [23, 25].includes(p.id))) {
      const expr = p.targets[0].expr
      assert.ok(expr.includes('| RouterName != "dashcam@docker"'))
      assert.ok(
        expr.includes(
          '| RouterName != "sabnzbd@docker" or DownstreamStatus != 302',
        ),
      )
    }
  })

  test('all probe panels use the same path filter', () => {
    const filters = new Set(
      probePanels.flatMap(p =>
        p.targets.map(t => /\| RequestPath =~ "[^"]*"/.exec(t.expr)?.[0]),
      ),
    )
    assert.equal(filters.size, 1)
  })
})

// ---------------------------------------------------------------------------
// docs/monitoring.md: the dashboard table lists every data source a file uses

describe('docs/monitoring.md dashboard table', () => {
  const jsonDir = new URL(
    '../grafana/provisioning/dashboards/json/',
    import.meta.url,
  )
  const docs = readFileSync(
    new URL('../../../docs/monitoring.md', import.meta.url),
    'utf8',
  )
  const names = { prometheus: 'Prometheus', loki: 'Loki' }

  const datasourceUids = node => {
    const uids = new Set()
    const walk = value => {
      if (Array.isArray(value)) return value.forEach(walk)
      if (value === null || typeof value !== 'object') return
      if (typeof value.datasource?.uid === 'string') {
        uids.add(value.datasource.uid)
      }
      Object.values(value).forEach(walk)
    }
    walk(node)
    return uids
  }

  const rows = new Map()
  for (const line of docs.split('\n')) {
    const cells = line.split('|').map(c => c.trim())
    const file = /^`([\w-]+\.json)`$/.exec(cells[3] ?? '')?.[1]
    if (file) rows.set(file, cells[5])
  }

  const files = readdirSync(jsonDir).filter(f => f.endsWith('.json'))

  test('every dashboard file has a row', () => {
    assert.deepEqual([...rows.keys()].sort(), files.sort())
  })

  for (const file of files) {
    test(`${file}: Data sources matches the datasource uids in the file`, () => {
      const dashboard = JSON.parse(readFileSync(new URL(file, jsonDir), 'utf8'))
      const expected = [...datasourceUids(dashboard)]
        .map(uid => names[uid] ?? uid)
        .sort()
        .join(', ')
      const documented = (rows.get(file) ?? '')
        .split(',')
        .map(s => s.trim())
        .sort()
        .join(', ')
      assert.equal(documented, expected)
    })
  }
})
