/**
 * GLB <-> FBX converter CLI for the theater app.
 *
 * Thin wrapper that drives the already-installed Blender in headless mode via
 * `scripts/blender_convert.py`. Local-only asset tooling — nothing here runs in
 * Docker or at runtime.
 *
 * Usage:
 *   pnpm --filter @lilnas/theater convert <input> [output]
 *   pnpm --filter @lilnas/theater convert <input...> --out-dir <dir>
 *
 * Examples:
 *   convert model.fbx                          # -> model.glb (beside input)
 *   convert model.glb out.fbx                  # explicit output
 *   convert model.glb out.zip                  # OBJ+mtl+textures bundle (Mixamo-ready)
 *   convert ./chars --out-dir ./out --to zip   # batch a folder to Mixamo zips
 *
 * Formats: .glb/.gltf and .fbx carry rig + animation; .obj is static geometry;
 * a .zip output bundles OBJ + .mtl + textures. Without --to or an explicit
 * output, .fbx <-> .glb is assumed. Set BLENDER_BIN to override the Blender
 * executable (defaults to `blender` on PATH).
 */

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const INPUT_EXTS = new Set(['.fbx', '.glb', '.gltf', '.obj'])
const OUTPUT_EXTS = new Set(['.fbx', '.glb', '.gltf', '.obj', '.zip'])
const MARKER = '[[CONVERT]]'

interface Job {
  input: string
  output: string
  scale?: number
}

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function printUsage(): void {
  console.log(
    [
      'Convert 3D assets between GLB/glTF, FBX, and OBJ (wraps headless Blender).',
      '',
      'Usage:',
      '  convert <input> [output]',
      '  convert <input...> --out-dir <dir> [--to <fmt>]',
      '',
      'Options:',
      '  --out-dir <dir>   Write outputs into <dir> (required for directories / many inputs)',
      '  --to <fmt>        Target for inferred outputs: glb, gltf, fbx, obj, zip',
      '  --scale <factor>  Extra uniform scale correction (for source files whose',
      '                    mesh itself is the wrong real-world size, not just a',
      '                    leftover Mixamo unit scale — that part is automatic)',
      '  -v, --verbose     Stream Blender output instead of a per-file summary',
      '  -h, --help        Show this help',
      '',
      '.glb/.gltf and .fbx carry rig + animation; .obj is static geometry only.',
      'A .zip output bundles OBJ + .mtl + textures (ready for Mixamo upload).',
      'Without --to or an explicit output, .fbx <-> .glb is assumed.',
      'Set BLENDER_BIN to override the Blender executable.',
    ].join('\n'),
  )
}

/** Convertible families: FBX, glTF ('.glb'/'.gltf'), and OBJ ('.obj'/'.zip'). */
function family(ext: string): 'fbx' | 'gltf' | 'obj' {
  if (ext === '.fbx') return 'fbx'
  if (ext === '.obj' || ext === '.zip') return 'obj'
  return 'gltf'
}

function defaultTargetExt(sourceExt: string): string {
  return sourceExt === '.fbx' ? '.glb' : '.fbx'
}

/** Resolve the output extension: explicit --to wins, else the default flip. */
function targetExt(sourceExt: string, to: string | undefined): string {
  if (to !== undefined) return to.startsWith('.') ? to : `.${to}`
  return defaultTargetExt(sourceExt)
}

function replaceExt(path: string, newExt: string): string {
  const ext = extname(path)
  return (ext ? path.slice(0, -ext.length) : path) + newExt
}

/** Expand any directories into their top-level convertible files. */
function collectInputs(paths: string[]): string[] {
  const files: string[] = []
  for (const path of paths) {
    if (!existsSync(path)) fail(`input not found: ${path}`)
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path)) {
        const full = join(path, entry)
        if (
          statSync(full).isFile() &&
          INPUT_EXTS.has(extname(entry).toLowerCase())
        ) {
          files.push(full)
        }
      }
    } else {
      files.push(path)
    }
  }
  return files
}

function validateJob(job: Job): void {
  const inExt = extname(job.input).toLowerCase()
  const outExt = extname(job.output).toLowerCase()
  if (!INPUT_EXTS.has(inExt)) {
    fail(`unsupported input extension "${inExt || '(none)'}": ${job.input}`)
  }
  if (!OUTPUT_EXTS.has(outExt)) {
    fail(`unsupported output extension "${outExt || '(none)'}": ${job.output}`)
  }
  if (family(inExt) === family(outExt)) {
    fail(
      `nothing to convert (${inExt} -> ${outExt} are the same format): ${job.input}`,
    )
  }
}

/** Turn parsed args into concrete, absolute-pathed jobs. */
function buildJobs(
  positionals: string[],
  outDir: string | undefined,
  to: string | undefined,
  scale: number | undefined,
): Job[] {
  let jobs: Job[]

  if (outDir !== undefined) {
    jobs = collectInputs(positionals).map(input => ({
      input,
      output: join(
        outDir,
        replaceExt(
          basename(input),
          targetExt(extname(input).toLowerCase(), to),
        ),
      ),
      scale,
    }))
  } else if (positionals.length === 1) {
    const input = positionals[0]
    if (input === undefined) fail('no input provided')
    if (existsSync(input) && statSync(input).isDirectory()) {
      fail('a directory input requires --out-dir <dir>')
    }
    jobs = [
      {
        input,
        output: replaceExt(input, targetExt(extname(input).toLowerCase(), to)),
        scale,
      },
    ]
  } else if (positionals.length === 2) {
    const input = positionals[0]
    const output = positionals[1]
    if (input === undefined || output === undefined)
      fail('expected <input> <output>')
    if (existsSync(input) && statSync(input).isDirectory()) {
      fail('a directory input requires --out-dir <dir>')
    }
    jobs = [{ input, output, scale }]
  } else {
    fail('multiple inputs require --out-dir <dir>')
  }

  const absolute = jobs.map(job => ({
    input: resolve(job.input),
    output: resolve(job.output),
    scale: job.scale,
  }))
  for (const job of absolute) {
    if (!existsSync(job.input)) fail(`input not found: ${job.input}`)
    validateJob(job)
  }
  if (absolute.length === 0) fail('no convertible files found')
  return absolute
}

function reportResults(stdout: string): void {
  for (const line of stdout.split('\n')) {
    const idx = line.indexOf(MARKER)
    if (idx === -1) continue
    const rest = line.slice(idx + MARKER.length).trim()
    if (rest.startsWith('ok ')) {
      console.log(`✓ ${rest.slice(3)}`)
    } else if (rest.startsWith('fail ')) {
      console.error(`✗ ${rest.slice(5)}`)
    } else {
      console.log(rest)
    }
  }
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'out-dir': { type: 'string' },
      to: { type: 'string' },
      scale: { type: 'string' },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })

  if (values.help) {
    printUsage()
    process.exit(0)
  }
  if (positionals.length === 0) {
    printUsage()
    process.exit(1)
  }

  const to = values.to
  if (to !== undefined) {
    const normalized = to.startsWith('.') ? to : `.${to}`
    if (!OUTPUT_EXTS.has(normalized)) {
      const allowed = [...OUTPUT_EXTS].map(ext => ext.slice(1)).join(', ')
      fail(`unsupported --to format "${to}" (expected one of: ${allowed})`)
    }
  }

  let scale: number | undefined
  if (values.scale !== undefined) {
    scale = Number(values.scale)
    if (!Number.isFinite(scale) || scale <= 0) {
      fail(`--scale must be a positive number, got "${values.scale}"`)
    }
  }

  const verbose = values.verbose ?? false
  const jobs = buildJobs(positionals, values['out-dir'], to, scale)

  const tmp = mkdtempSync(join(tmpdir(), 'theater-convert-'))
  try {
    const jobsPath = join(tmp, 'jobs.json')
    writeFileSync(jobsPath, JSON.stringify(jobs), 'utf8')

    const blenderBin = process.env.BLENDER_BIN ?? 'blender'
    const script = join(__dirname, 'blender_convert.py')
    const result = spawnSync(
      blenderBin,
      ['--background', '--python', script, '--', jobsPath],
      { encoding: 'utf8', stdio: verbose ? 'inherit' : 'pipe' },
    )

    if (result.error) {
      const err = result.error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        fail(
          `Blender not found (looked for "${blenderBin}"). ` +
            'Install Blender or set BLENDER_BIN to its path.',
        )
      }
      fail(`failed to run Blender: ${err.message}`)
    }

    if (!verbose) reportResults(result.stdout ?? '')

    if (result.status !== 0) {
      if (!verbose && result.stderr) {
        console.error(result.stderr.trim().split('\n').slice(-10).join('\n'))
      }
      process.exit(result.status ?? 1)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

main()
