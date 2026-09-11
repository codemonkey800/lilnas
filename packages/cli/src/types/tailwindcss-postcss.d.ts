/*
 * `@tailwindcss/postcss` ships its types only through `exports`, with no
 * top-level `main`/`types`. This package compiles with `moduleResolution:
 * "node"` (node10), which predates `exports` and so can't see them.
 *
 * Switching the package to `node16` isn't an option: `@oclif/core` is also
 * exports-only and currently resolves under node10 semantics, so the flip
 * would have to be all-or-nothing across the CLI. The plugin's surface here is
 * two options, so declaring it is cheaper than that migration.
 */
declare module '@tailwindcss/postcss' {
  import { PluginCreator } from 'postcss'

  interface TailwindPluginOptions {
    /** Directory scanned for class candidates. Defaults to the cwd. */
    base?: string
    /** Optimize and minify the output CSS. */
    optimize?: boolean | { minify?: boolean }
  }

  const tailwindcss: PluginCreator<TailwindPluginOptions>
  export default tailwindcss
}
