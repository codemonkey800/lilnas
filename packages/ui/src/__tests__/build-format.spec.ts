import path from 'path'
import ts from 'typescript'

// Next's RSC client-reference proxy cannot re-export a CommonJS barrel
// (`tsc` lowers `export *` to `__exportStar`), so a server layout importing
// `AppBar` from '@lilnas/ui' got `undefined`. The dist must keep ES module
// syntax and leave resolution to the consuming bundler.
describe('@lilnas/ui build output format', () => {
  const configPath = path.resolve(__dirname, '../../tsconfig.json')
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile)
  const { options } = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    path.dirname(configPath),
  )

  it('emits ES module syntax for re-export barrels', () => {
    const { outputText } = ts.transpileModule(
      "export * from './button'\nexport { a } from './a'\n",
      { compilerOptions: options, fileName: 'index.ts' },
    )

    expect(outputText).toContain("export * from './button'")
    expect(outputText).not.toContain('__exportStar')
    expect(outputText).not.toContain('require(')
  })

  it('resolves modules the way a bundler does', () => {
    expect(options.moduleResolution).toBe(ts.ModuleResolutionKind.Bundler)
    expect(options.module).toBe(ts.ModuleKind.Preserve)
  })
})
